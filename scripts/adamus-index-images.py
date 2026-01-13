import base64
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


PROJECT_REF = "ycmkfqduvziydyfnrczj"
SQL_API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


def sanitize_text(value):
    if not value:
        return ""
    value = value.encode("utf-8", "ignore").decode("utf-8")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", value)


def load_env(path):
    env = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def sql_escape(value):
    return value.replace("'", "''")


def sql_literal(value):
    safe = sanitize_text(value)
    base_tag = "adamus"
    tag = f"${base_tag}$"
    counter = 0
    while tag in safe:
        counter += 1
        tag = f"${base_tag}_{counter}$"
    return f"{tag}{safe}{tag}"


def sql_query(token, query, retries=5, backoff=1.5):
    payload = json.dumps({"query": query}).encode("utf-8")
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            SQL_API_URL,
            data=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read().decode("utf-8")
                return body
        except urllib.error.HTTPError as exc:
            if exc.code in {401, 429, 500, 502, 503, 504} and attempt < retries:
                time.sleep(backoff * (attempt + 1))
                continue
            raise


def call_vision(api_key, image_path):
    content = base64.b64encode(Path(image_path).read_bytes()).decode("ascii")
    payload = {
        "requests": [
            {
                "image": {"content": content},
                "features": [{"type": "TEXT_DETECTION"}],
            }
        ]
    }
    url = f"https://vision.googleapis.com/v1/images:annotate?key={api_key}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read().decode("utf-8")
            data = json.loads(body)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"OCR request failed: {exc}") from exc
    text = ""
    try:
        text = data["responses"][0]["fullTextAnnotation"]["text"]
    except (KeyError, IndexError, TypeError):
        text = ""
    return sanitize_text(text.strip())


def chunk_text(text, max_len=1200, overlap=200):
    if not text:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    chunks = []
    current = ""
    for p in paragraphs:
        if len(current) + len(p) + 1 <= max_len:
            current = f"{current}\n{p}".strip()
            continue
        if current:
            chunks.append(current)
        if len(p) <= max_len:
            current = p
        else:
            start = 0
            while start < len(p):
                end = min(start + max_len, len(p))
                chunks.append(p[start:end])
                start = end - overlap if end - overlap > start else end
            current = ""
    if current:
        chunks.append(current)
    return chunks


def select_images(folder):
    folder_path = Path(folder)
    files = [
        p for p in folder_path.iterdir()
        if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    ]
    chosen = {}
    for f in files:
        name = f.stem
        base = re.sub(r"\s+1$", "", name)
        key = base + f.suffix.lower()
        if key not in chosen:
            chosen[key] = f
            continue
        if " 1" in f.stem and " 1" not in chosen[key].stem:
            continue
        if " 1" not in f.stem and " 1" in chosen[key].stem:
            chosen[key] = f
    selected = list(chosen.values())

    def sort_key(p):
        match = re.search(r"IMG_(\d+)", p.stem)
        if match:
            return (0, int(match.group(1)), p.name)
        return (1, p.name)

    return sorted(selected, key=sort_key)


def main():
    env_path = os.environ.get("ADAMUS_ENV_PATH")
    folder = os.environ.get("ADAMUS_INPUT_PATH")
    if not env_path or not folder:
        raise SystemExit("Set ADAMUS_ENV_PATH and ADAMUS_INPUT_PATH.")

    env = load_env(env_path)
    token = env.get("SUPABASE_ACCESS_TOKEN")
    api_key = env.get("GOOGLE_API_KEY")
    if not token or not api_key:
        raise SystemExit("SUPABASE_ACCESS_TOKEN or GOOGLE_API_KEY missing.")

    subject_name = os.environ.get("ADAMUS_SUBJECT", "Biologie")
    subject_description = os.environ.get(
        "ADAMUS_SUBJECT_DESCRIPTION",
        "Hoofdstuk 4: Stevigheid en beweging",
    )
    chapter = os.environ.get("ADAMUS_CHAPTER")
    paragraph = os.environ.get("ADAMUS_PARAGRAPH")
    title = os.environ.get("ADAMUS_TITLE", "Biologie hoofdstuk 4 (scans)")
    source_uri = os.environ.get("ADAMUS_SOURCE_URI", "local://vakken/biologie-h4")
    force_pages_raw = os.environ.get("ADAMUS_FORCE_PAGES", "")
    chunk_max = int(os.environ.get("ADAMUS_CHUNK_MAX", "1200"))
    chunk_overlap = int(os.environ.get("ADAMUS_CHUNK_OVERLAP", "200"))
    force_pages = {
        int(p.strip())
        for p in force_pages_raw.split(",")
        if p.strip().isdigit()
    }

    images = select_images(folder)
    if not images:
        raise SystemExit("No images found.")

    print(f"images: {len(images)}")

    subject_sql = (
        "insert into adamus.subjects (name, description) "
        f"values ('{sql_escape(subject_name)}', '{sql_escape(subject_description)}') "
        "on conflict (name) do update set description = excluded.description "
        "returning id;"
    )
    subject_res = sql_query(token, subject_sql)
    subject_id = json.loads(subject_res)[0]["id"]

    material_select_sql = (
        "select id from adamus.materials "
        f"where source_uri = '{sql_escape(source_uri)}' "
        "limit 1;"
    )
    material_select_res = json.loads(sql_query(token, material_select_sql))
    if material_select_res:
        material_id = material_select_res[0]["id"]
    else:
        chapter_value = "null" if chapter is None else f"'{sql_escape(chapter)}'"
        paragraph_value = "null" if paragraph is None else f"'{sql_escape(paragraph)}'"
        material_sql = (
            "insert into adamus.materials "
            "(subject_id, chapter, paragraph, title, source_type, source_uri, metadata) "
            "values ("
            f"'{subject_id}', {chapter_value}, {paragraph_value}, "
            f"'{sql_escape(title)}', "
            "'image', "
            f"'{sql_escape(source_uri)}', "
            f"'{{\"count\": {len(images)}}}'::jsonb"
            ") returning id;"
        )
        material_res = sql_query(token, material_sql)
        material_id = json.loads(material_res)[0]["id"]

    existing_pages_sql = (
        "select p.page_no, p.image_uri, p.ocr_text, "
        "(select count(*) from adamus.material_chunks c where c.page_id = p.id) "
        "as chunk_count "
        "from adamus.material_pages p "
        f"where p.material_id = '{material_id}';"
    )
    existing_pages = json.loads(sql_query(token, existing_pages_sql))
    existing_by_page = {
        row["page_no"]: row for row in existing_pages
    }
    existing_by_uri = {
        row["image_uri"]: row for row in existing_pages if row["image_uri"]
    }

    for idx, image_path in enumerate(images, start=1):
        print(f"ocr {idx}/{len(images)}: {image_path.name}")
        image_uri = f"file://{image_path.as_posix()}"
        existing = existing_by_page.get(idx) or existing_by_uri.get(image_uri)
        if existing and int(existing.get("chunk_count", 0)) > 0 and idx not in force_pages:
            print(f"skip existing page {idx}: {image_path.name}")
            continue

        text = call_vision(api_key, image_path)
        time.sleep(0.3)
        page_sql = (
            "insert into adamus.material_pages "
            "(material_id, page_no, image_uri, ocr_text, ocr_confidence) "
            "values ("
            f"'{material_id}', {idx}, '{sql_escape(image_uri)}', "
            f"{sql_literal(text)}, null"
            ") "
            "on conflict (material_id, page_no) do update set "
            "image_uri = excluded.image_uri, "
            "ocr_text = excluded.ocr_text, "
            "ocr_confidence = excluded.ocr_confidence "
            "returning id;"
        )
        page_res = sql_query(token, page_sql)
        page_id = json.loads(page_res)[0]["id"]

        delete_chunks_sql = (
            "delete from adamus.material_chunks "
            f"where page_id = '{page_id}';"
        )
        sql_query(token, delete_chunks_sql)
        time.sleep(0.2)

        chunks = chunk_text(text, max_len=chunk_max, overlap=chunk_overlap)
        for c_idx, chunk in enumerate(chunks, start=1):
            chunk_sql = (
                "insert into adamus.material_chunks "
                "(material_id, page_id, chunk_index, content) "
                "values ("
                f"'{material_id}', '{page_id}', {c_idx}, "
                f"{sql_literal(chunk)}"
                ");"
            )
            try:
                sql_query(token, chunk_sql)
                time.sleep(0.1)
            except Exception as exc:
                preview = chunk[:200].replace("\n", " ")
                print(f"chunk insert failed page {idx} chunk {c_idx}: {exc}")
                print(f"chunk preview: {preview!r}")
                fallback = chunk.encode("ascii", "ignore").decode("ascii").strip()
                if fallback and fallback != chunk:
                    try:
                        fallback_sql = (
                            "insert into adamus.material_chunks "
                            "(material_id, page_id, chunk_index, content) "
                            "values ("
                            f"'{material_id}', '{page_id}', {c_idx}, "
                            f"{sql_literal(fallback)}"
                            ");"
                        )
                        sql_query(token, fallback_sql)
                        time.sleep(0.1)
                        print(f"fallback insert ok page {idx} chunk {c_idx}")
                    except Exception as fallback_exc:
                        print(f"fallback insert failed page {idx} chunk {c_idx}: {fallback_exc}")

    print("done")


if __name__ == "__main__":
    main()
