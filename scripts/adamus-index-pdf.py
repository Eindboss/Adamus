import json
import os
import time
from pathlib import Path

from pypdf import PdfReader

import urllib.error
import urllib.request


PROJECT_REF = "ycmkfqduvziydyfnrczj"
SQL_API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query"


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
    safe = value.replace("\u0000", "")
    tag = "$adamus$"
    if tag in safe:
        tag = "$adamus_text$"
        if tag in safe:
            tag = "$adamus_chunk$"
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


def chunk_text(text, max_len=1200, overlap=200):
    if not text:
        return []
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
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


def main():
    env_path = os.environ.get("ADAMUS_ENV_PATH")
    pdf_path = os.environ.get("ADAMUS_PDF_PATH")
    if not env_path or not pdf_path:
        raise SystemExit("Set ADAMUS_ENV_PATH and ADAMUS_PDF_PATH.")

    env = load_env(env_path)
    token = env.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        raise SystemExit("SUPABASE_ACCESS_TOKEN missing.")

    subject_name = os.environ.get("ADAMUS_SUBJECT", "Geschiedenis")
    subject_description = os.environ.get(
        "ADAMUS_SUBJECT_DESCRIPTION",
        "Werkplaats hoofdstuk 2 paragraaf 2 en hoofdstuk 3 paragraaf 1-5",
    )
    chapter = os.environ.get("ADAMUS_CHAPTER")
    paragraph = os.environ.get("ADAMUS_PARAGRAPH")
    title = os.environ.get("ADAMUS_TITLE", "Jaartallen 1B")
    source_uri = os.environ.get(
        "ADAMUS_SOURCE_URI",
        "local://vakken/geschiedenis-jaartallen-1b",
    )

    reader = PdfReader(pdf_path)
    page_texts = []
    for page in reader.pages:
        text = page.extract_text() or ""
        page_texts.append(text.strip())

    if not any(page_texts):
        raise SystemExit("PDF has no extractable text.")

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
            "'pdf', "
            f"'{sql_escape(source_uri)}', "
            f"'{{\"pages\": {len(page_texts)}}}'::jsonb"
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
    existing_by_page = {row["page_no"]: row for row in existing_pages}

    for idx, text in enumerate(page_texts, start=1):
        existing = existing_by_page.get(idx)
        if existing and int(existing.get("chunk_count", 0)) > 0:
            continue
        page_sql = (
            "insert into adamus.material_pages "
            "(material_id, page_no, image_uri, ocr_text, ocr_confidence) "
            "values ("
            f"'{material_id}', {idx}, '{sql_escape(source_uri)}', "
            f"{sql_literal(text)}, null"
            ") "
            "on conflict (material_id, page_no) do update set "
            "ocr_text = excluded.ocr_text "
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

        chunks = chunk_text(text)
        for c_idx, chunk in enumerate(chunks, start=1):
            chunk_sql = (
                "insert into adamus.material_chunks "
                "(material_id, page_id, chunk_index, content) "
                "values ("
                f"'{material_id}', '{page_id}', {c_idx}, "
                f"{sql_literal(chunk)}"
                ");"
            )
            sql_query(token, chunk_sql)
            time.sleep(0.1)

    print("done")


if __name__ == "__main__":
    main()
