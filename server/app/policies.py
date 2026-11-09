"""Parse uploaded policies into bounded, source-addressable passages."""
import hashlib
import io
import re
from pypdf import PdfReader

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PAGES = 100
MAX_TEXT_CHARS = 1_000_000


def split_text(text, size=1600):
    text = re.sub(r'\s+', ' ', text).strip()
    return [text[i:i+size] for i in range(0, len(text), size) if text[i:i+size].strip()]


def parse_policy(raw: bytes, filename: str, doc_id: str, title: str):
    if not raw or len(raw) > MAX_FILE_BYTES: raise ValueError('File must be between 1 byte and 5 MB.')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', doc_id): raise ValueError('Document ID must contain 1–64 letters, digits, dots, dashes or underscores.')
    title = title.strip()
    if not title or len(title) > 200: raise ValueError('Provide a policy name of at most 200 characters.')
    lower = filename.lower()
    pages = []
    if lower.endswith('.pdf'):
        if not raw.startswith(b'%PDF-'): raise ValueError('The file is not a valid PDF.')
        try:
            reader = PdfReader(io.BytesIO(raw), strict=False)
            if reader.is_encrypted: raise ValueError('Encrypted PDFs are not supported.')
            if len(reader.pages) > MAX_PAGES: raise ValueError('PDFs must be 100 pages or fewer.')
            pages = [(i, page.extract_text() or '') for i, page in enumerate(reader.pages, 1)]
        except ValueError: raise
        except Exception as e: raise ValueError('Could not read this PDF. Upload a text-based PDF.') from e
    elif lower.endswith(('.txt', '.md')):
        try: pages = [(None, raw.decode('utf-8-sig'))]
        except UnicodeDecodeError as e: raise ValueError('Text files must use UTF-8 encoding.') from e
    else: raise ValueError('Upload a PDF, Markdown or text file.')
    if sum(len(text) for _, text in pages) > MAX_TEXT_CHARS: raise ValueError('Extracted document text is too large.')
    chunks = []
    for number, text in pages:
        for index, passage in enumerate(split_text(text), 1):
            chunk = {'docId':doc_id, 'docTitle':title, 'sectionTitle':f'Page {number}, passage {index}' if number else f'Passage {index}', 'content':passage}
            if number is not None: chunk['pageNumber'] = number
            chunks.append(chunk)
    if not chunks: raise ValueError('No readable text found. Scanned PDFs require OCR before upload.')
    return chunks, hashlib.sha256(raw).hexdigest()
