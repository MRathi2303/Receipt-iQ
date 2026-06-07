"""
receipt_extractor.py
────────────────────
Fully self-contained receipt/invoice parser.
Extraction pipeline:
  1. pdfplumber  — selectable-text + spatial layout + table detection
  2. Tesseract   — OCR fallback for scanned / image-only pages
  3. Gemini      — LLM semantic extraction (PDF bytes + text context)
  4. Merge       — intelligent field-level merge preferring best source

Dependencies (Lambda layer / requirements.txt):
    pdfplumber>=0.10
    pdf2image>=1.17
    pytesseract>=0.3.10
    Pillow>=10.0

System dependency (Lambda layer):
    tesseract-ocr  (with eng + osd traineddata)
    poppler-utils  (for pdf2image)
"""

import io
import json
import os
import re
import logging
import base64
import urllib.error
import urllib.request
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

import boto3
import pdfplumber
import pytesseract
from pdf2image import convert_from_bytes

# Load .env for local runs (safe no-op in Lambda)
try:  # pragma: no cover - convenience only
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ── Environment ───────────────────────────────────────────────────────────────
REGION          = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME      = os.environ.get("DYNAMODB_TABLE_NAME", "YOUR_DYNAMODB_TABLE_NAME")
FRONTEND_URL    = os.environ.get("FRONTEND_URL", "https://YOUR_FRONTEND_URL")
AWS_ACCOUNT_ID  = os.environ.get("AWS_ACCOUNT_ID", "")
GEMINI_API_KEY  = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL    = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

# ── AWS clients ───────────────────────────────────────────────────────────────
s3       = boto3.client("s3", region_name=REGION)
dynamodb = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)
sns      = boto3.client("sns", region_name=REGION)

ALLOWED_TOPIC_PREFIX = (
    f"arn:aws:sns:{REGION}:{AWS_ACCOUNT_ID}:"
    if AWS_ACCOUNT_ID
    else f"arn:aws:sns:{REGION}:"
)
MAX_DOC_ID_LEN = 128

# ── Category rules ────────────────────────────────────────────────────────────
CATEGORY_RULES = [
    ("food",          re.compile(r"\b(restaurant|cafe|coffee|bakery|grocery|supermarket|food|dining|swiggy|zomato|pizza|burger|biryani|dhaba|canteen|eatery|diner|mess|tiffin|barbeque|bbq|juice|snack|halwai)\b", re.I)),
    ("travel",        re.compile(r"\b(airline|airport|flight|railway|irctc|metro|hotel|uber|ola|rapido|airbnb|travel|booking|cab|taxi|bus|makemytrip|goibibo|redbus|toll|parking|petrol|diesel|fuel|lodge|resort|hostel)\b", re.I)),
    ("utilities",     re.compile(r"\b(internet|broadband|water|electric|electricity|gas|telecom|mobile|wifi|utility|bsnl|airtel|jio|vi|vodafone|idea|bescom|tata\s*power|adani\s*power|mseb|bill\s*payment)\b", re.I)),
    ("medical",       re.compile(r"\b(hospital|clinic|pharmacy|medical|health|doctor|diagnostic|lab|dental|medicine|apollo|fortis|medplus|netmeds|1mg|healthkart|optician|ayurveda|chemist|drugstore)\b", re.I)),
    ("entertainment", re.compile(r"\b(cinema|movie|pvr|inox|bookmyshow|netflix|spotify|prime|hotstar|game|ticket|event|concert|theatre|amusement|park|bowling|arcade)\b", re.I)),
    ("education",     re.compile(r"\b(school|college|university|tuition|coaching|course|udemy|coursera|byju|unacademy|book|stationery|library|fees|examination)\b", re.I)),
    ("shopping",      re.compile(r"\b(store|retail|amazon|flipkart|myntra|meesho|nykaa|mall|mart|shopping|fashion|electronics|reliance|dmart|bigbazaar|croma|vijay\s*sales)\b", re.I)),
]

# ── Known platform detection ──────────────────────────────────────────────────
PLATFORM_PATTERNS = [
    (re.compile(r"\bamazon\.in\b|\bamazon\s+india\b|\bASSPL\b|\bARIPL\b", re.I), "Amazon.in"),
    (re.compile(r"\bflipcart\b|\bfkicart\b|\bflipkart\b", re.I),               "Flipkart"),
    (re.compile(r"\bswiggy\b", re.I),                                           "Swiggy"),
    (re.compile(r"\bzomato\b", re.I),                                           "Zomato"),
    (re.compile(r"\bubereats\b|\buber\s+eats\b", re.I),                        "Uber Eats"),
    (re.compile(r"\bmyntra\b", re.I),                                           "Myntra"),
    (re.compile(r"\bmeesho\b", re.I),                                           "Meesho"),
    (re.compile(r"\bnykaa\b", re.I),                                            "Nykaa"),
    (re.compile(r"\bblinkit\b|\bgrofers\b", re.I),                             "Blinkit"),
    (re.compile(r"\bzepto\b", re.I),                                            "Zepto"),
    (re.compile(r"\bbig\s*basket\b", re.I),                                    "BigBasket"),
    (re.compile(r"\bjiomart\b", re.I),                                          "JioMart"),
    (re.compile(r"\bcroma\b", re.I),                                            "Croma"),
    (re.compile(r"\bd[\s\-]?mart\b", re.I),                                    "DMart"),
    (re.compile(r"\bbig\s*bazar\b|\bbig\s*bazaar\b", re.I),                   "Big Bazaar"),
    (re.compile(r"\breliance\s*(digital|smart|fresh|trends|retail)?\b", re.I), "Reliance Retail"),
    (re.compile(r"\birctc\b", re.I),                                            "IRCTC"),
    (re.compile(r"\bmakemytrip\b", re.I),                                       "MakeMyTrip"),
    (re.compile(r"\bgoibibo\b", re.I),                                          "Goibibo"),
    (re.compile(r"\bredbus\b", re.I),                                           "redBus"),
    (re.compile(r"\bolph\b|\bola\b", re.I),                                     "Ola"),
    (re.compile(r"\buber\b", re.I),                                             "Uber"),
    (re.compile(r"\brapido\b", re.I),                                           "Rapido"),
    (re.compile(r"\bbookmyshow\b", re.I),                                       "BookMyShow"),
    (re.compile(r"\bpvr\b", re.I),                                              "PVR Cinemas"),
    (re.compile(r"\binox\b", re.I),                                             "INOX"),
    (re.compile(r"\bapollo\s*(pharmacy|hospital|clinic)?\b", re.I),            "Apollo"),
    (re.compile(r"\bmedplus\b", re.I),                                          "MedPlus"),
    (re.compile(r"\bnetmeds\b", re.I),                                          "Netmeds"),
    (re.compile(r"\b1mg\b", re.I),                                              "1mg"),
    (re.compile(r"\bhealthkart\b", re.I),                                       "HealthKart"),
    (re.compile(r"\bairtel\b", re.I),                                           "Airtel"),
    (re.compile(r"\bjio\b", re.I),                                              "Jio"),
    (re.compile(r"\bvodafone\b|\bvi\b", re.I),                                 "Vi (Vodafone Idea)"),
    (re.compile(r"\bbsnl\b", re.I),                                             "BSNL"),
    (re.compile(r"\btata\s*power\b", re.I),                                    "Tata Power"),
    (re.compile(r"\badani\s*(electricity|power)\b", re.I),                     "Adani Electricity"),
]

# ── Anchor patterns (local parser fallback) ───────────────────────────────────
FIELD_ANCHORS = {
    "invoice_id": [
        r"invoice\s*(?:no|number|#|id|details)?\s*[:\-]?\s*(.+)",
        r"receipt\s*(?:no|number|#|id)?\s*[:\-]?\s*(.+)",
        r"bill\s*(?:no|number|#|id)?\s*[:\-]?\s*(.+)",
        r"order\s*(?:no|number|#|id)?\s*[:\-]?\s*(.+)",
        r"ref(?:erence)?\s*(?:no|number|#|id)?\s*[:\-]?\s*(.+)",
        r"transaction\s*(?:id|no|#)?\s*[:\-]?\s*(.+)",
        r"(?:doc|document)\s*(?:no|number|#)?\s*[:\-]?\s*(.+)",
    ],
    "date": [
        r"(?:invoice|bill|receipt|order|transaction|issue|dated?)?\s*date\s*[:\-]?\s*(.+)",
        r"dated?\s*[:\-]?\s*(.+)",
        r"(?:on|issued)\s*[:\-]?\s*(\d[\d\/\-\s\w,.]+)",
    ],
    "total": [
        r"grand\s*total\s*[:\-]?\s*(.+)",
        r"net\s*(?:payable|amount|total)\s*[:\-]?\s*(.+)",
        r"amount\s*(?:due|payable|paid)\s*[:\-]?\s*(.+)",
        r"total\s*amount\s*[:\-]?\s*(.+)",
        r"invoice\s*total\s*[:\-]?\s*(.+)",
        r"(?<!\w)total\s*[:\-]?\s*(.+)",
    ],
    "subtotal": [
        r"sub[\s\-]?total\s*[:\-]?\s*(.+)",
        r"taxable\s*(?:value|amount)\s*[:\-]?\s*(.+)",
    ],
    "tax": [
        r"(?:total\s+)?(?:cgst|sgst|igst|vat|gst|tax)\s*(?:@[\d.]+%)?\s*[:\-]?\s*(.+)",
        r"tax\s*(?:amount)?\s*[:\-]?\s*(.+)",
    ],
    "payment_terms": [
        r"(?:paid\s+(?:via|by|through)|payment\s+(?:method|mode|via|by))\s*[:\-]?\s*(.+)",
        r"(?:mode|method)\s+of\s+payment\s*[:\-]?\s*(.+)",
    ],
    "merchant_explicit": [
        r"(?:sold\s+by|seller|merchant|vendor|billed\s+by|from)\s*[:\-]?\s*(.+)",
        r"(?:company|business|firm)\s+name\s*[:\-]?\s*(.+)",
    ],
}

DATE_FORMATS = [
    "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y",
    "%d %b %Y", "%d %B %Y", "%b %d %Y", "%B %d %Y",
    "%d %b, %Y", "%d %B, %Y", "%d/%m/%y", "%m/%d/%y",
    "%d.%m.%Y", "%d.%m.%y",
]

_MERCHANT_BLACKLIST = re.compile(
    r"^(tax\s+invoice|bill\s+of\s+supply|cash\s+memo|original|duplicate|"
    r"recipient|customer\s+copy|authorized\s+signatory|gstin|gst\s+no|"
    r"pan\s+no|cin|invoice|receipt|bill|statement|for\s+.+\s*:|page\s+\d)$",
    re.I,
)

_ITEM_NOISE = re.compile(
    r"\s*[\|\/]\s*\d{10,13}\b"
    r"|\s*\(\s*[A-Z0-9\-]{4,30}\s*\)"
    r"|\s*\|\s*[A-Z0-9\-]{4,30}\b"
    r"|\s*HSN\s*:\s*\d+",
    re.I,
)


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def _is_image_file(key: str) -> bool:
    return os.path.splitext(key.lower())[1] in IMAGE_EXTENSIONS


def handler(event, context):
    logger.info("Lambda triggered: %s record(s)", len(event.get("Records", [])))
    results = []

    for record in event.get("Records", []):
        bucket = record.get("s3", {}).get("bucket", {}).get("name")
        key    = record.get("s3", {}).get("object", {}).get("key", "").replace("+", " ")
        ctx    = None

        if not bucket or not key:
            continue

        try:
            metadata  = get_s3_metadata(bucket, key)
            ctx       = build_receipt_context(bucket, key, metadata)
            file_bytes = get_s3_file(bucket, key)

            if _is_image_file(key):
                extracted = extract_image(file_bytes, key)
            else:
                extracted = extract_receipt(file_bytes)

            result     = build_result_record(ctx, extracted)
            email_out  = send_notification(result)

            result["emailDeliveryStatus"] = email_out["status"]
            result["emailMessageId"]      = email_out.get("messageId")
            result["emailErrorMessage"]   = email_out.get("errorMessage")
            result["updatedAt"]           = iso_now()

            write_to_database(result)
            results.append({"docId": result["docId"], "status": "processed"})

        except Exception as err:
            logger.error("Failed processing %s: %s", key, err, exc_info=True)
            write_failure_record(ctx, bucket, key, err)
            results.append({"key": key, "status": "failed", "error": str(err)})

    return {"statusCode": 200, "processed": results}


def extract_image(file_bytes: bytes, key: str) -> dict:
    """Extract receipt data from an image file (JPG/PNG/WebP) using OCR + Gemini."""
    from PIL import Image as PILImage

    img = PILImage.open(io.BytesIO(file_bytes))
    ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)

    lines, bucket, cur_line = [], [], None
    for i in range(len(ocr_data["text"])):
        word = sanitize_text(ocr_data["text"][i])
        if not word or str(ocr_data["conf"][i]) in ("-1", ""):
            continue
        line_key = (ocr_data["block_num"][i], ocr_data["par_num"][i], ocr_data["line_num"][i])
        x0, y0 = ocr_data["left"][i], ocr_data["top"][i]
        x1, y1 = x0 + ocr_data["width"][i], y0 + ocr_data["height"][i]
        if line_key == cur_line:
            bucket.append((word, x0, y0, x1, y1))
        else:
            if bucket:
                lines.append(_ocr_bucket_to_line(bucket))
            bucket, cur_line = [(word, x0, y0, x1, y1)], line_key
    if bucket:
        lines.append(_ocr_bucket_to_line(bucket))

    line_texts = [line.text for line in lines if line.text]
    full_text  = "\n".join(line_texts)

    local_extracted  = _parse_document(lines, [])

    # Send image to Gemini for extraction
    ext = os.path.splitext(key.lower())[1]
    mime_map = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
    gemini_extracted = _extract_with_gemini_image(file_bytes, mime_map.get(ext, "image/jpeg"), full_text)

    extracted = _merge_extraction_results(gemini_extracted, local_extracted)
    _fill_missing_from_text(extracted, full_text, local_extracted.get("lineItems") or [])
    _apply_platform_detection(extracted, full_text)
    _clean_line_item_names(extracted)
    _compute_confidence(extracted, gemini_extracted, local_extracted, lines)
    extracted["processingMethod"] = ("gemini+" if gemini_extracted else "") + "ocr_image"
    return extracted


def _extract_with_gemini_image(file_bytes: bytes, mime_type: str, ocr_text: str) -> Optional[dict]:
    """Send an image to Gemini for receipt extraction."""
    if not GEMINI_API_KEY:
        return None
    try:
        b64_data = base64.b64encode(file_bytes).decode("utf-8")
        prompt = _build_gemini_prompt(ocr_text, [])
        payload = {
            "contents": [{
                "parts": [
                    {"inline_data": {"mime_type": mime_type, "data": b64_data}},
                    {"text": prompt}
                ]
            }],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096}
        }
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=55) as resp:
            body = json.loads(resp.read())
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        return _parse_gemini_response(text)
    except Exception as exc:
        logger.warning("Gemini image extraction failed: %s", exc)
        return None


def extract_receipt(file_bytes: bytes) -> dict:
    all_lines  = []
    table_rows = []
    used_ocr   = False

    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page_idx, page in enumerate(pdf.pages, start=1):
            for table in (page.extract_tables() or []):
                for row in table:
                    cleaned = [sanitize_text(c) for c in (row or []) if sanitize_text(c)]
                    if cleaned:
                        table_rows.append(cleaned)

            words = page.extract_words(
                x_tolerance=4,
                y_tolerance=4,
                keep_blank_chars=False,
                use_text_flow=True,
            )

            if words and _word_density(words) >= 20:
                all_lines.extend(_words_to_lines(words))
            else:
                used_ocr = True
                all_lines.extend(_ocr_page(file_bytes, page_idx))

    line_texts  = [line.text for line in all_lines if line.text]
    full_text   = "\n".join(line_texts)

    local_extracted  = _parse_document(all_lines, table_rows)
    gemini_extracted = _extract_with_gemini(file_bytes, full_text, table_rows)
    extracted        = _merge_extraction_results(gemini_extracted, local_extracted)

    _fill_missing_from_text(extracted, full_text, local_extracted.get("lineItems") or [])
    _apply_platform_detection(extracted, full_text)
    _clean_line_item_names(extracted)
    _compute_confidence(extracted, gemini_extracted, local_extracted, all_lines)

    extracted["processingMethod"] = (
        ("gemini+" if gemini_extracted else "") +
        ("ocr+spatial" if used_ocr else "spatial")
    )
    return extracted


def _apply_platform_detection(extracted: dict, full_text: str):
    for pattern, platform_name in PLATFORM_PATTERNS:
        if pattern.search(full_text):
            extracted["platform"] = platform_name
            current = extracted.get("merchant") or ""
            if platform_name.lower() not in current.lower():
                extracted["merchant"] = platform_name
            return


def _clean_line_item_names(extracted: dict):
    items = extracted.get("lineItems") or []
    cleaned_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or ""
        name = _ITEM_NOISE.sub("", name).strip()
        name = re.sub(r"[\|\-\:\/]+$", "", name).strip()
        if name == name.upper() and len(name) > 4:
            name = name.title()
        if len(name) > 120:
            name = name[:117].rsplit(" ", 1)[0] + "…"
        item = dict(item)
        item["name"] = sanitize_text(name) or "Item"
        cleaned_items.append(item)
    extracted["lineItems"] = cleaned_items


def _compute_confidence(extracted: dict, gemini: Optional[dict],
                        local: dict, lines: list):
    key_fields = ["merchant", "date", "total", "invoiceId", "currency"]
    found = sum(1 for f in key_fields if extracted.get(f))
    field_score = (found / len(key_fields)) * 60

    items = extracted.get("lineItems") or []
    item_score = min(len(items) * 4, 20)

    source_score = 0
    if gemini:
        source_score += 15
    real_lines = sum(1 for l in lines if l.text and len(l.text) > 4)
    if real_lines >= 20:
        source_score += 5

    confidence = Decimal(str(round(field_score + item_score + source_score, 1)))
    extracted["confidence"] = min(confidence, Decimal("99.0"))


def _extract_with_gemini(file_bytes: bytes, full_text: str,
                         table_rows: list) -> Optional[dict]:
    if not GEMINI_API_KEY or not file_bytes:
        return None

    prompt  = _build_gemini_prompt(full_text, table_rows)
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": "application/pdf",
                            "data": base64.b64encode(file_bytes).decode("ascii"),
                        }
                    },
                    {"text": prompt},
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.0,
            "responseMimeType": "application/json",
        },
    }

    url     = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}")
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        logger.error("Gemini HTTP %s: %s", exc.code,
                     exc.read().decode("utf-8", errors="ignore")[:500])
        return None
    except Exception as exc:
        logger.error("Gemini request failed: %s", exc)
        return None

    raw_text = _extract_gemini_text(body)
    if not raw_text:
        logger.warning("Gemini returned empty content")
        return None

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text.strip())
        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError:
            logger.error("Gemini non-JSON: %s", raw_text[:400])
            return None

    return _normalize_gemini_result(parsed, full_text)


def _build_gemini_prompt(full_text: str, table_rows: list) -> str:
    compact_tables = "\n".join(" | ".join(row) for row in table_rows[:25])
    return f"""
You are a precise receipt and invoice data extraction engine.
Analyse the attached PDF using its visual layout, tables, and text.
The OCR text and table rows below are supplemental context only.
Return ONLY valid JSON — no markdown, no explanation, no preamble.

════════════════════════════════════════
FIELD EXTRACTION RULES
════════════════════════════════════════

merchant
  - The name of the business, store, restaurant, platform, or service provider
    that issued this document. This is who the customer paid.
  - For e-commerce/marketplace invoices (Amazon, Flipkart, Swiggy, Zomato,
    Blinkit, Zepto, BigBasket, Myntra, Meesho, etc.): use the PLATFORM name
    (e.g. "Amazon.in", "Flipkart", "Swiggy"), NOT the individual third-party
    seller listed under "Sold By".
  - For restaurant/cafe receipts: use the restaurant name from the header.
  - For utility/telecom bills: use the company name (e.g. "Airtel", "Jio").
  - For local shop/general invoices: use the business name at the top.
  - NEVER use: customer name, billing address, product title, signatory name,
    GST number, PAN, long address strings, or legal disclaimers.
  - Max 60 characters.

invoiceId
  - The primary document reference number — invoice number, receipt number,
    or bill number. Prefer "Invoice No" over "Order Number" if both exist.
  - For Amazon: prefer "Invoice Number" (e.g. IN-407) over Order Number.
  - For restaurants/shops: the bill/receipt number.
  - For utilities: the bill number or consumer number.
  - Clean format only — no label text, no full sentences.
  - Max 64 characters.

date
  - The invoice/bill/receipt date, NOT the order date or shipping date.
  - Return as YYYY-MM-DD. If only month/year is available, use YYYY-MM-01.
  - Prefer "Invoice Date" > "Bill Date" > "Receipt Date" > "Order Date".

total
  - The final amount the customer actually paid or owes.
  - Prefer "Grand Total" > "Total Amount" > "Net Payable" > "Amount Due".
  - For Amazon/e-commerce: this is the "Total Amount" column value for the
    order, NOT the tax amount column.
  - Include currency symbol as it appears. Example: "₹249.00", "$19.99".
  - NEVER return phone numbers, GST numbers, HSN codes, order IDs, or
    quantities as the total.

subtotal
  - Pre-tax amount. May be labelled "Subtotal", "Taxable Value", "Net Amount".
  - If only total exists and tax is 0%, subtotal = total.
  - Null if not determinable.

tax
  - Total tax charged (GST, CGST+SGST, IGST, VAT, service charge combined).
  - If multiple tax lines exist, sum them mentally and return total.
  - If tax is 0%, return "₹0.00" or equivalent — do not return null.
  - Null only if tax information is completely absent.

currency
  - ISO 4217 code: INR, USD, EUR, GBP, AED, etc.
  - Infer from symbols: ₹ = INR, $ = USD, € = EUR, £ = GBP.
  - Default to INR for Indian documents.

paymentTerms
  - Payment method used: "UPI", "Credit Card", "Cash", "Net Banking", "COD",
    "Debit Card", "Wallet", "NEFT", "Cheque", etc.
  - Only if explicitly stated. Null otherwise.

category
  - One of: food, travel, utilities, medical, entertainment, education,
    shopping, other.
  - Infer from merchant type, line items, and document context.
  - "shopping" for e-commerce orders, retail, general stores.
  - "food" for restaurants, cafes, food delivery.
  - "travel" for flights, trains, hotels, cabs, fuel.
  - "utilities" for electricity, internet, mobile bills.
  - "medical" for hospitals, pharmacies, diagnostics.
  - "entertainment" for movies, events, streaming.
  - "education" for schools, courses, books (when it is clearly a book receipt).

lineItems
  - Array of individual products/services billed.
  - name: Clean product/service name only.
    * Strip ISBN codes, SKU codes, HSN codes, barcode numbers.
    * Strip content in parentheses that looks like internal codes.
    * Strip pipe-separated codes. Keep only the human-readable title.
    * If ALL CAPS, convert to Title Case.
    * Max 100 characters.
  - quantity: Number (integer or decimal). Null if not stated.
  - unitPrice: String with currency symbol. Null if not stated.
  - totalPrice: String with currency symbol. Null if not stated.
  - Skip rows that are totals, taxes, discounts, or header labels.
  - Maximum 30 line items.

════════════════════════════════════════
OUTPUT FORMAT (return exactly this shape)
════════════════════════════════════════
{{
  "merchant": string|null,
  "invoiceId": string|null,
  "date": string|null,
  "total": string|null,
  "subtotal": string|null,
  "tax": string|null,
  "currency": string|null,
  "paymentTerms": string|null,
  "category": string|null,
  "lineItems": [
    {{
      "name": string,
      "quantity": number|null,
      "unitPrice": string|null,
      "totalPrice": string|null
    }}
  ]
}}

════════════════════════════════════════
SUPPLEMENTAL OCR TEXT
════════════════════════════════════════
{full_text[:20000]}

════════════════════════════════════════
TABLE ROWS
════════════════════════════════════════
{compact_tables[:6000]}
""".strip()


def _extract_gemini_text(response_json: dict) -> Optional[str]:
    for candidate in (response_json.get("candidates") or []):
        for part in (candidate.get("content", {}).get("parts") or []):
            text = part.get("text")
            if text:
                return text.strip()
    return None


def _normalize_gemini_result(parsed: dict, full_text: str) -> Optional[dict]:
    if not isinstance(parsed, dict):
        return None

    currency = _infer_currency(
        f"{parsed.get('currency') or ''} {parsed.get('total') or ''} {full_text[:2000]}"
    )

    line_items = []
    for item in (parsed.get("lineItems") or []):
        if not isinstance(item, dict):
            continue
        name = sanitize_text(item.get("name")) or "Item"
        line_items.append({
            "name":       name,
            "quantity":   _safe_decimal(item.get("quantity")),
            "unitPrice":  _money(item.get("unitPrice"),  currency) if item.get("unitPrice")  else None,
            "totalPrice": _money(item.get("totalPrice"), currency) if item.get("totalPrice") else None,
        })

    category = sanitize_text(parsed.get("category") or "")
    if category:
        category = category.lower()
    valid_cats = {"food","travel","utilities","medical","entertainment","education","shopping","other","auto"}
    if category not in valid_cats:
        category = "auto"

    return {
        "merchant":     clean_merchant(parsed.get("merchant")),
        "date":         normalize_date(parsed.get("date")),
        "invoiceId":    clean_invoice_id(parsed.get("invoiceId")),
        "total":        _money(parsed.get("total"),    currency),
        "subtotal":     _money(parsed.get("subtotal"), currency),
        "tax":          _money(parsed.get("tax"),      currency),
        "currency":     currency,
        "paymentTerms": sanitize_text(parsed.get("paymentTerms")),
        "lineItems":    line_items,
        "category":     category,
    }


def _merge_extraction_results(primary: Optional[dict], fallback: dict) -> dict:
    if not primary:
        return dict(fallback)

    merged = dict(fallback)

    for key in ("merchant", "date", "invoiceId", "currency", "paymentTerms", "category"):
        if _prefer_primary_scalar(primary.get(key), fallback.get(key)):
            merged[key] = primary.get(key)

    for key in ("total", "subtotal", "tax"):
        if _prefer_primary_money(primary.get(key), fallback.get(key)):
            merged[key] = primary.get(key)

    primary_items  = primary.get("lineItems")  or []
    fallback_items = fallback.get("lineItems") or []
    if _line_items_score(primary_items) >= _line_items_score(fallback_items):
        merged["lineItems"] = primary_items

    if not merged.get("category") or merged.get("category") in ("auto", None):
        merged["category"] = classify_category(
            merged.get("merchant") or "", merged.get("lineItems") or []
        )

    return merged


def _prefer_primary_scalar(primary, fallback) -> bool:
    pt = sanitize_text(primary)
    ft = sanitize_text(fallback)
    if not pt:
        return False
    if pt.lower() in {"unknown", "unknown merchant", "not detected", "n/a", "none", "auto"}:
        return False
    if len(pt) > 120:
        return False
    if _MERCHANT_BLACKLIST.match(pt):
        return False
    if not ft:
        return True
    if ft.lower() in {"unknown merchant", "auto", "unknown"}:
        return True
    return True


def _prefer_primary_money(primary, fallback) -> bool:
    if not primary:
        return False
    pv = primary.get("numericValue")
    if pv is None or pv < 0:
        return False
    if not fallback:
        return True
    fv = fallback.get("numericValue") if isinstance(fallback, dict) else None
    if fv is None:
        return True
    if fv > Decimal("10000000") and pv < fv:
        return True
    return pv != fv


def _line_items_score(items: list) -> int:
    score = 0
    for item in items:
        if not isinstance(item, dict):
            continue
        name = sanitize_text(item.get("name"))
        if not name or name.lower() in ("item", ""):
            continue
        score += 1
        if len(name) <= 100:
            score += 1
        if item.get("totalPrice") and item["totalPrice"].get("numericValue") is not None:
            score += 2
        if item.get("quantity") is not None:
            score += 1
    return score


def _fill_missing_from_text(result: dict, full_text: str, fallback_items: list):
    text  = full_text or ""
    lines = [sanitize_text(l) for l in text.splitlines() if sanitize_text(l)]

    if not result.get("merchant"):
        merchant = _merchant_from_lines(lines)
        if not merchant:
            for pattern in (
                r"Sold\s+By\s*:?[ \t]*([^\n]+)",
                r"Seller\s*:?[ \t]*([^\n]+)",
                r"Billed\s+By\s*:?[ \t]*([^\n]+)",
                r"From\s*:?[ \t]*([^\n]+)",
            ):
                m = re.search(pattern, text, re.I)
                if m:
                    candidate = sanitize_text(m.group(1).splitlines()[0])
                    merchant  = clean_merchant(candidate) if candidate else None
                    if merchant:
                        break
        if merchant:
            result["merchant"] = merchant

    if not result.get("invoiceId"):
        for pattern in (
            r"Invoice\s+(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]{2,64})",
            r"Receipt\s+(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]{2,64})",
            r"Bill\s+(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-\/]{2,64})",
            r"Order\s+(?:No|Number)\s*[:\-]?\s*([A-Z0-9\-]{6,})",
        ):
            m = re.search(pattern, text, re.I)
            if m:
                result["invoiceId"] = clean_invoice_id(m.group(1))
                break

    if not result.get("date"):
        for pattern in (
            r"Invoice\s+Date\s*[:\-]?\s*([\d./\- ]{6,12})",
            r"Bill\s+Date\s*[:\-]?\s*([\d./\- ]{6,12})",
            r"Receipt\s+Date\s*[:\-]?\s*([\d./\- ]{6,12})",
            r"Order\s+Date\s*[:\-]?\s*([\d./\- ]{6,12})",
        ):
            m = re.search(pattern, text, re.I)
            if m:
                normalized = normalize_date(m.group(1).strip())
                if normalized:
                    result["date"] = normalized
                    break

    line_items = result.get("lineItems") or fallback_items or []
    line_total = _sum_line_items(line_items)
    if not result.get("total") and line_total:
        result["total"] = line_total

    if not result.get("subtotal") and result.get("total"):
        tax_val = (result.get("tax") or {}).get("numericValue") or Decimal("0")
        if tax_val == 0:
            result["subtotal"] = result["total"]

    if not result.get("tax") and result.get("total") and result.get("subtotal"):
        diff = (result["total"]["numericValue"] - result["subtotal"]["numericValue"]).quantize(Decimal("0.01"))
        cur = result["total"]["currency"]
        if diff > 0:
            result["tax"] = {
                "numericValue": diff,
                "currency":     cur,
                "display":      _fmt_money(diff, cur),
            }
        else:
            result["tax"] = {
                "numericValue": Decimal("0.00"),
                "currency":     cur,
                "display":      _fmt_money(Decimal("0.00"), cur),
            }


def _sum_line_items(items: list) -> Optional[dict]:
    total_val = Decimal("0")
    currency  = None
    found     = False
    for item in items:
        if not isinstance(item, dict):
            continue
        price = item.get("totalPrice") or {}
        if price and price.get("numericValue") is not None:
            found    = True
            currency = currency or price.get("currency") or "INR"
            total_val += Decimal(str(price["numericValue"]))
            continue
        qty  = item.get("quantity")
        unit = item.get("unitPrice") or {}
        if qty is not None and unit.get("numericValue") is not None:
            found    = True
            currency = currency or unit.get("currency") or "INR"
            total_val += Decimal(str(unit["numericValue"])) * Decimal(str(qty))
    if not found:
        return None
    rounded = total_val.quantize(Decimal("0.01"))
    return {
        "numericValue": rounded,
        "currency":     currency or "INR",
        "display":      _fmt_money(rounded, currency or "INR"),
    }


def _parse_document(lines: list, table_rows: list) -> dict:
    full_text = " ".join(line.text for line in lines if line.text)
    currency  = _infer_currency(full_text)

    invoice_id   = _extract_anchor(lines, "invoice_id")
    date_raw     = _extract_anchor(lines, "date") or _scan_dates(full_text)
    total_raw    = _extract_anchor(lines, "total")
    subtotal_raw = _extract_anchor(lines, "subtotal")
    tax_raw      = _extract_anchor(lines, "tax")
    payment_terms = _extract_anchor(lines, "payment_terms")
    merchant_raw  = _extract_anchor(lines, "merchant_explicit") or _heuristic_merchant(lines)
    line_items    = _extract_line_items(table_rows, [line.text for line in lines], currency)

    if not total_raw:
        total_raw = _largest_amount_fallback([line.text for line in lines])

    return {
        "merchant":     clean_merchant(merchant_raw),
        "date":         normalize_date(date_raw),
        "invoiceId":    clean_invoice_id(invoice_id),
        "total":        _money(total_raw,    currency),
        "subtotal":     _money(subtotal_raw, currency),
        "tax":          _money(tax_raw,      currency),
        "currency":     currency,
        "paymentTerms": sanitize_text(payment_terms),
        "lineItems":    line_items,
        "category":     "auto",
    }


def _extract_anchor(lines: list, field: str) -> Optional[str]:
    patterns = [re.compile(p, re.I) for p in FIELD_ANCHORS.get(field, [])]

    for idx, line in enumerate(lines):
        for pattern in patterns:
            match = pattern.fullmatch(line.text.strip()) or pattern.match(line.text.strip())
            if not match:
                continue
            captured = sanitize_text(match.group(1)) if match.lastindex else None
            if captured and len(captured) >= 2 and not _is_noise(captured):
                return captured
            line_h = max(line.y1 - line.y0, 8)
            for next_line in lines[idx + 1: idx + 5]:
                if not next_line.text:
                    continue
                if (next_line.y0 - line.y1) > line_h * 3:
                    break
                value = sanitize_text(next_line.text)
                if value and not _is_label(value):
                    return value
    return None


def _is_noise(text: str) -> bool:
    return bool(re.fullmatch(r"[\s:,\-.]+", text.strip()))


def _is_label(text: str) -> bool:
    lowered = text.lower().strip()
    label_words = (
        "total", "subtotal", "tax", "gst", "cgst", "sgst", "date", "invoice",
        "receipt", "bill", "order", "merchant", "description", "qty", "amount",
        "seller", "vendor", "address", "phone", "email", "www", "http",
    )
    return any(lowered.startswith(w) for w in label_words) and ":" in text


def _merchant_from_lines(lines: list) -> Optional[str]:
    for idx, line in enumerate(lines):
        if re.search(r"\bsold\s+by\b|\bseller\b|\bbilled\s+by\b", line, re.I):
            block = []
            for nxt in lines[idx + 1: idx + 8]:
                if re.search(r"shipping address|billing address|place of supply|state/ut code|gstin|gst\s+no", nxt, re.I):
                    break
                block.append(nxt)
            block = [b for b in block if b and not re.search(r"(billing|shipping) address", b, re.I)]
            if block:
                first  = block[0]
                tokens = first.split()
                candidate = " ".join(tokens[:3]) if len(tokens) >= 3 else first
                cleaned   = clean_merchant(candidate)
                if cleaned:
                    return cleaned
            suffix = line.split(":", 1)[-1].strip() if ":" in line else ""
            if suffix and not re.search(r"address", suffix, re.I):
                return clean_merchant(suffix)
    return None


def _heuristic_merchant(lines: list) -> Optional[str]:
    banned = (
        "tax invoice", "invoice", "receipt", "bill", "gstin", "date", "total",
        "phone", "mobile", "email", "www", "http", "qty", "amount",
        "description", "hsn", "fssai", "cin", "pan", "gst", "authorized",
        "signatory", "original", "duplicate", "page",
    )
    candidates = []
    for idx, line in enumerate(lines[:12]):
        text = line.text.strip()
        if not text or len(text) < 3:
            continue
        if any(flag in text.lower() for flag in banned):
            continue
        if not re.search(r"[A-Za-z]{3,}", text):
            continue
        score = max(0, (8 - idx) * 3)
        if text == text.upper() and len(text) > 3:
            score += 8
        elif text == text.title():
            score += 4
        if not re.search(r"\d", text):
            score += 5
        if ":" in text:
            score -= 10
        if len(text) < 5:
            score -= 15
        candidates.append((score, text))
    if not candidates:
        return None
    return max(candidates, key=lambda x: x[0])[1]


def _extract_line_items(table_rows: list, text_lines: list, currency: str) -> list:
    items = _items_from_tables(table_rows, currency)
    return items[:30] if items else _items_from_lines(text_lines, currency)[:30]


def _items_from_tables(table_rows: list, currency: str) -> list:
    header_idx = col_name = col_qty = col_price = col_total = None

    for index, row in enumerate(table_rows[:8]):
        low    = [cell.lower() for cell in row]
        joined = " ".join(low)
        has_desc   = any(w in joined for w in ("description", "item", "product", "particular", "name"))
        has_amount = any(w in joined for w in ("amount", "price", "total", "rate"))
        if has_desc and has_amount:
            header_idx = index
            for ci, cell in enumerate(low):
                if any(w in cell for w in ("description", "item", "product", "particular", "name")) and col_name is None:
                    col_name = ci
                if any(w in cell for w in ("qty", "quantity", "nos", "units", "pcs")) and col_qty is None:
                    col_qty = ci
                if any(w in cell for w in ("rate", "unit price", "unit cost")) and col_price is None:
                    col_price = ci
                if any(w in cell for w in ("amount", "total", "net")) and col_total is None:
                    col_total = ci
            break

    if header_idx is None or col_name is None:
        return _items_heuristic(table_rows, currency)

    items = []
    for row in table_rows[header_idx + 1:]:
        if len(row) <= col_name:
            continue
        name = sanitize_text(row[col_name])
        if not name or _is_table_junk(name):
            continue
        qty        = _safe_decimal(row[col_qty])   if col_qty   is not None and col_qty   < len(row) else None
        unit_price = _money(row[col_price], currency) if col_price is not None and col_price < len(row) else None
        total_price= _money(row[col_total], currency) if col_total is not None and col_total < len(row) else None

        if unit_price is None and total_price and qty and qty > 0:
            uv = (total_price["numericValue"] / Decimal(str(qty))).quantize(Decimal("0.01"))
            unit_price = {"numericValue": uv, "currency": currency, "display": _fmt_money(uv, currency)}

        items.append({"name": name, "quantity": qty, "unitPrice": unit_price, "totalPrice": total_price})
    return items


def _items_heuristic(table_rows: list, currency: str) -> list:
    skip  = ("total", "subtotal", "tax", "gst", "cgst", "sgst", "discount", "amount due", "grand", "net payable")
    items = []
    for row in table_rows:
        if len(row) < 2:
            continue
        if _parse_number(row[-1]) is None:
            continue
        name = sanitize_text(row[0])
        if not name or any(flag in name.lower() for flag in skip):
            continue
        items.append({
            "name":       name,
            "quantity":   _safe_decimal(row[1]) if len(row) > 2 else None,
            "unitPrice":  None,
            "totalPrice": _money(row[-1], currency),
        })
    return items


def _items_from_lines(text_lines: list, currency: str) -> list:
    skip = (
        "total", "subtotal", "tax", "gst", "vat", "cgst", "sgst",
        "discount", "amount due", "grand", "net payable",
        "description", "qty", "rate", "hsn", "item",
    )
    items = []
    for line in text_lines:
        if any(flag in line.lower() for flag in skip):
            continue
        money_matches = list(re.finditer(r"(?:[A-Z]{3}\s*)?[₹$€£]?\s*\d[\d,]*(?:\.\d{1,2})?", line))
        if not money_matches:
            continue
        last   = money_matches[-1]
        amount = _money(last.group(0), currency)
        if not amount:
            continue
        name = sanitize_text(line[:last.start()])
        if not name or len(name) < 3 or not re.search(r"[A-Za-z]{2,}", name):
            continue
        qty_match = re.search(
            r"\bqty\b[\s:]*(\d+(?:\.\d+)?)"
            r"|\b(\d+(?:\.\d+)?)\s*[xX×]\b"
            r"|\b(\d+(?:\.\d+)?)\s+(?:nos?|pcs?|units?)\b",
            line, re.I,
        )
        qty = _safe_decimal(next(g for g in qty_match.groups() if g)) if qty_match else None
        items.append({"name": name, "quantity": qty, "unitPrice": None, "totalPrice": amount})
    return items


def _is_table_junk(text: str) -> bool:
    low  = text.lower()
    junk = ("total", "subtotal", "tax", "gst", "amount", "grand", "net",
            "description", "item", "product", "sl no", "s.no", "sr no", "#")
    if any(low.startswith(f) for f in junk) or len(text) < 2:
        return True
    if re.fullmatch(r"[₹$€£]?\s*[\d,.-]+", text):
        return True
    return False


class Line:
    __slots__ = ("text", "x0", "y0", "x1", "y1")
    def __init__(self, text, x0, y0, x1, y1):
        self.text = text
        self.x0   = x0
        self.y0   = y0
        self.x1   = x1
        self.y1   = y1


def _word_density(words: list) -> int:
    return sum(len(w.get("text", "").strip()) for w in words)


def _words_to_lines(words: list) -> list:
    if not words:
        return []
    sorted_w = sorted(words, key=lambda w: (round(w["top"] / 4) * 4, w["x0"]))
    lines, bucket = [], [sorted_w[0]]
    for word in sorted_w[1:]:
        if abs(word["top"] - bucket[-1]["top"]) <= 4:
            bucket.append(word)
        else:
            lines.append(_bucket_to_line(bucket))
            bucket = [word]
    lines.append(_bucket_to_line(bucket))
    return lines


def _bucket_to_line(words: list) -> Line:
    text = " ".join(w.get("text", "") for w in words)
    return Line(
        sanitize_text(text) or "",
        min(w["x0"]     for w in words),
        min(w["top"]    for w in words),
        max(w["x1"]     for w in words),
        max(w["bottom"] for w in words),
    )


def _ocr_page(file_bytes: bytes, page_number: int) -> list:
    try:
        images = convert_from_bytes(file_bytes, dpi=300,
                                    first_page=page_number, last_page=page_number)
        if not images:
            return []
        data  = pytesseract.image_to_data(images[0], output_type=pytesseract.Output.DICT)
        lines = []
        bucket, cur_line = [], None
        for i in range(len(data["text"])):
            word = sanitize_text(data["text"][i])
            if not word or str(data["conf"][i]) in ("-1", ""):
                continue
            line_key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            x0, y0   = data["left"][i], data["top"][i]
            x1, y1   = x0 + data["width"][i], y0 + data["height"][i]
            if line_key == cur_line:
                bucket.append((word, x0, y0, x1, y1))
            else:
                if bucket:
                    lines.append(_ocr_bucket_to_line(bucket))
                bucket, cur_line = [(word, x0, y0, x1, y1)], line_key
        if bucket:
            lines.append(_ocr_bucket_to_line(bucket))
        return lines
    except Exception as exc:
        logger.warning("OCR failed page %s: %s", page_number, exc)
        return []


def _ocr_bucket_to_line(bucket: list) -> Line:
    return Line(
        sanitize_text(" ".join(w[0] for w in bucket)) or "",
        min(w[1] for w in bucket),
        min(w[2] for w in bucket),
        max(w[3] for w in bucket),
        max(w[4] for w in bucket),
    )


def _infer_currency(text: str) -> str:
    """Return ISO currency code inferred from symbols/keywords; default INR."""
    pattern_map = [
        ("INR", r"₹|(?<!\\w)rs\\.?(?!\\w)|(?<!\\w)inr(?!\\w)"),
        ("USD", r"(?<!\\w)usd(?!\\w)|\\$"),
        ("EUR", r"€|(?<!\\w)eur(?!\\w)"),
        ("GBP", r"£|(?<!\\w)gbp(?!\\w)"),
        ("AED", r"(?<!\\w)aed(?!\\w)"),
    ]
    for code, pattern in pattern_map:
        if re.search(pattern, text, re.I):
            return code
    return "INR"


def _money(raw, currency: str) -> Optional[dict]:
    if not raw:
        return None
    cleaned = re.sub(
        r"[₹$€£]|(?<!\w)(?:INR|USD|EUR|GBP|AED|RS\.?)", "",
        str(raw), flags=re.I
    )
    value = _parse_number(cleaned)
    if value is None or value < 0:
        return None
    rounded = value.quantize(Decimal("0.01"))
    return {"numericValue": rounded, "currency": currency, "display": _fmt_money(rounded, currency)}


def _parse_number(text) -> Optional[Decimal]:
    v = re.sub(r"[^\d,.-]", "", str(text or "")).strip()
    if not v:
        return None
    if "," in v and "." in v:
        v = v.replace(".", "").replace(",", ".") if v.rfind(",") > v.rfind(".") else v.replace(",", "")
    elif "," in v:
        parts = v.split(",")
        v = v.replace(",", ".") if len(parts[-1]) == 2 else v.replace(",", "")
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def _safe_decimal(val) -> Optional[Decimal]:
    n = _parse_number(str(val)) if val is not None else None
    return n.quantize(Decimal("0.01")) if n is not None else None


def _fmt_money(value: Decimal, currency: str) -> str:
    symbols = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£", "AED": "AED "}
    return f"{symbols.get(currency, currency + ' ')}{value:,.2f}"


def _scan_dates(text: str) -> Optional[str]:
    named = re.search(
        r"\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b"
        r"|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b",
        text, re.I,
    )
    if named:
        return named.group(0)
    numeric = re.search(
        r"\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b"
        r"|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b"
        r"|\b\d{1,2}\.\d{1,2}\.\d{4}\b",
        text,
    )
    return numeric.group(0) if numeric else None


def _largest_amount_fallback(text_lines: list) -> Optional[str]:
    best_val, best_text = Decimal("0"), None
    for line in text_lines:
        for m in re.finditer(r"[₹$€£]?\s*\d[\d,]*(?:\.\d{1,2})?", line):
            value  = _parse_number(m.group(0))
            if value is None:
                continue
            digits = re.sub(r"\D", "", m.group(0))
            if len(digits) >= 8 and not re.search(r"[₹$€£]", m.group(0)):
                continue
            if value > best_val:
                best_val, best_text = value, m.group(0)
    return best_text


def classify_category(merchant: str, line_items: list) -> str:
    text = f"{merchant or ''} " + " ".join(item.get("name", "") for item in line_items)
    for category, pattern in CATEGORY_RULES:
        if pattern.search(text):
            return category
    return "other"


def clean_merchant(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    value = re.split(
        r"(?:billing|shipping)\s+address|invoice\s+(?:no|number|date|details)|"
        r"gstin|gst\s+(?:no|number)|order\s+(?:no|number)|place\s+of\s+supply|"
        r"customers\s+desirous|amount\s+in\s+words|authorized\s+signatory|"
        r"near\b|road\b|street\b|nagar\b|colony\b|district\b",
        value, maxsplit=1, flags=re.I,
    )[0]
    value = re.sub(r"^(?:sold\s+by|seller|merchant|vendor|from|billed\s+by)\s*[:\-]\s*", "", value, flags=re.I)
    value = re.sub(r"^tax\s+invoice[\s/]*(?:bill\s+of\s+supply)?[\s/]*(?:cash\s+memo)?\s*", "", value, flags=re.I)
    value = re.sub(r"\s*\*+\s*$", "", value).strip()
    cleaned = sanitize_text(value)
    if not cleaned:
        return None
    if _MERCHANT_BLACKLIST.match(cleaned):
        return None
    return cleaned[:80]


def clean_invoice_id(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    m = re.search(r"[A-Z0-9][A-Z0-9\-\/]{2,63}", value, re.I)
    return m.group(0)[:64] if m else sanitize_text(value)[:64] if value else None


def normalize_date(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    cleaned = sanitize_text(value)
    if not cleaned:
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    m = re.match(r"^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$", cleaned)
    if m:
        first, second, year = m.groups()
        year = f"20{year}" if len(year) == 2 else year
        day, month = (first, second) if int(first) > 12 else (second, first) if int(second) > 12 else (first, second)
        try:
            return datetime(int(year), int(month), int(day)).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def build_result_record(ctx: dict, extracted: dict) -> dict:
    category = ctx["requestedCategory"]
    if category == "auto":
        category = (
            extracted.get("category")
            or classify_category(extracted.get("merchant") or "", extracted.get("lineItems", []))
        )
    now      = iso_now()
    total    = extracted.get("total")
    subtotal = extracted.get("subtotal")
    tax      = extracted.get("tax")
    return {
        "docId":               ctx["docId"],
        "bucket":              ctx["bucket"],
        "s3Key":               ctx["key"],
        "originalName":        ctx["originalName"],
        "email":               ctx["email"],
        "userId":              ctx.get("userId"),
        "userName":            ctx.get("userName"),
        "notificationStatus":  ctx.get("notificationStatus"),
        "notificationTopicArn":ctx.get("notificationTopicArn"),
        "merchant":            extracted.get("merchant") or "Unknown Merchant",
        "platform":            extracted.get("platform"),
        "date":                extracted.get("date"),
        "total":               total["display"]           if total    else None,
        "totalValue":          total["numericValue"]      if total    else None,
        "subtotal":            subtotal["display"]        if subtotal else None,
        "subtotalValue":       subtotal["numericValue"]   if subtotal else None,
        "tax":                 tax["display"]             if tax      else None,
        "taxValue":            tax["numericValue"]        if tax      else None,
        "currency":            extracted.get("currency") or "INR",
        "invoiceId":           extracted.get("invoiceId"),
        "paymentTerms":        extracted.get("paymentTerms"),
        "lineItems":           extracted.get("lineItems", []),
        "category":            category,
        "confidence":          extracted.get("confidence"),
        "processingMethod":    extracted.get("processingMethod", "spatial"),
        "createdAt":           now,
        "updatedAt":           now,
        "status":              "processed",
    }


def get_s3_metadata(bucket: str, key: str) -> dict:
    return s3.head_object(Bucket=bucket, Key=key).get("Metadata", {})


def get_s3_file(bucket: str, key: str) -> bytes:
    return s3.get_object(Bucket=bucket, Key=key)["Body"].read()


def build_receipt_context(bucket: str, key: str, metadata: dict) -> dict:
    raw_id = sanitize_text(metadata.get("docid")) or strip_extension(os.path.basename(key))
    return {
        "bucket":               bucket,
        "key":                  key,
        "docId":                sanitize_doc_id(raw_id),
        "email":                sanitize_email(metadata.get("email")) or "unknown@example.com",
        "originalName":         sanitize_text(metadata.get("originalname")) or os.path.basename(key),
        "requestedCategory":    _safe_category(metadata.get("category")),
        "userId":               sanitize_text(metadata.get("userid")),
        "userName":             sanitize_text(metadata.get("username")),
        "notificationStatus":   sanitize_text(metadata.get("notificationstatus")) or "pending_verification",
        "notificationTopicArn": validate_topic_arn(sanitize_text(metadata.get("notificationtopicarn"))),
    }


def _safe_category(value) -> str:
    valid   = {"food", "travel", "utilities", "medical", "shopping", "entertainment", "education", "other", "auto"}
    cleaned = sanitize_text(value)
    return cleaned.lower() if cleaned and cleaned.lower() in valid else "auto"


def write_to_database(result: dict):
    dynamodb.put_item(Item=result)


def write_failure_record(ctx: Optional[dict], bucket: str, key: str, err: Exception):
    timestamp = iso_now()
    dynamodb.put_item(Item={
        "docId":               ctx.get("docId") if ctx else sanitize_doc_id(strip_extension(os.path.basename(key))),
        "bucket":              bucket,
        "s3Key":               key,
        "originalName":        ctx.get("originalName") if ctx else os.path.basename(key),
        "email":               ctx.get("email")        if ctx else None,
        "userId":              ctx.get("userId")       if ctx else None,
        "userName":            ctx.get("userName")     if ctx else None,
        "notificationStatus":  "failed",
        "notificationTopicArn":ctx.get("notificationTopicArn") if ctx else None,
        "merchant":            None,
        "platform":            None,
        "date":                None,
        "total":               None,
        "subtotal":            None,
        "tax":                 None,
        "currency":            None,
        "invoiceId":           None,
        "paymentTerms":        None,
        "lineItems":           [],
        "category":            "other",
        "confidence":          None,
        "createdAt":           timestamp,
        "updatedAt":           timestamp,
        "status":              "failed",
        "emailDeliveryStatus": "failed",
        "errorMessage":        str(err)[:1000],
    })


def _check_topic_has_confirmed_subscription(topic_arn: str) -> bool:
    """Check live SNS state: does this topic have at least one confirmed subscription?"""
    try:
        paginator_token = None
        while True:
            kwargs = {"TopicArn": topic_arn}
            if paginator_token:
                kwargs["NextToken"] = paginator_token
            resp = sns.list_subscriptions_by_topic(**kwargs)
            for sub in resp.get("Subscriptions", []):
                arn = sub.get("SubscriptionArn", "")
                if arn.startswith("arn:aws:sns:"):
                    # Real ARN means it's confirmed
                    return True
            paginator_token = resp.get("NextToken")
            if not paginator_token:
                break
    except Exception as exc:
        logger.warning("Could not verify topic subscriptions for %s: %s", topic_arn, exc)
    return False


def send_notification(result: dict) -> dict:
    topic_arn = result.get("notificationTopicArn")
    if not topic_arn:
        return {"status": "skipped", "messageId": None,
                "errorMessage": "No SNS topic configured."}

    # Don't trust the stale notificationStatus from S3 metadata.
    # Instead, check the live SNS subscription state.
    if not _check_topic_has_confirmed_subscription(topic_arn):
        return {"status": "pending_verification", "messageId": None,
                "errorMessage": "SNS subscription not yet verified."}

    try:
        display_merchant = result.get("platform") or result.get("merchant") or "Receipt"
        subject  = f"ReceiptIQ: {display_merchant}"[:100]
        response = sns.publish(
            TopicArn=topic_arn,
            Subject=subject,
            Message=_notification_body(result),
        )
        return {"status": "sent", "messageId": response.get("MessageId"), "errorMessage": None}
    except Exception as exc:
        logger.error("SNS failed for %s: %s", result["docId"], exc)
        return {"status": "failed", "messageId": None, "errorMessage": str(exc)}


def _notification_body(result: dict) -> str:
    merchant = result.get("platform") or result.get("merchant") or "Unknown"
    items = result.get("lineItems", [])
    category = (result.get("category") or "other").replace("_", " ").title()

    # Build line items table rows
    item_rows = ""
    for item in items[:8]:
        name = item.get("name", "Item")
        qty = item.get("quantity", "—")
        price = ""
        if isinstance(item.get("totalPrice"), dict):
            price = item["totalPrice"].get("display", "—")
        elif isinstance(item.get("totalPrice"), str):
            price = item["totalPrice"]
        else:
            price = "—"
        item_rows += f"""<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;font-size:14px;color:#374151">{name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;font-size:14px;color:#6b7280;text-align:center">{qty}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eef2f7;font-size:14px;color:#374151;text-align:right">{price}</td>
        </tr>\n"""
    if len(items) > 8:
        item_rows += f"""<tr><td colspan="3" style="padding:8px 12px;font-size:13px;color:#9ca3af;text-align:center">+{len(items)-8} more items</td></tr>\n"""

    items_section = ""
    if item_rows:
        items_section = f"""<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
            <tr style="background:#f8fafc">
                <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:700;border-bottom:2px solid #e5e7eb">Product</th>
                <th style="padding:10px 12px;text-align:center;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:700;border-bottom:2px solid #e5e7eb">Qty</th>
                <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;font-weight:700;border-bottom:2px solid #e5e7eb">Price</th>
            </tr>
            {item_rows}
        </table>"""

    return f"""Hello,

Your receipt from {merchant} has been processed.

Merchant  : {merchant}
Date      : {result.get('date') or 'Not detected'}
Category  : {category}
Subtotal  : {result.get('subtotal') or 'Not detected'}
Tax       : {result.get('tax') or 'Not detected'}
Total     : {result.get('total') or 'Not detected'}

Products:
{chr(10).join('  • ' + item.get('name','Item') + (' × ' + str(item.get('quantity','')) if item.get('quantity') else '') for item in items[:8])}
{('  ... and ' + str(len(items)-8) + ' more items') if len(items) > 8 else ''}

Confidence: {result.get('confidence') or 'N/A'}
Doc ID    : {result['docId']}

View your receipts: {FRONTEND_URL}
"""


def sanitize_text(value) -> Optional[str]:
    if value is None:
        return None
    return re.sub(r"\s+", " ", str(value)).strip() or None


def sanitize_email(value) -> Optional[str]:
    email = sanitize_text(value)
    return email if email and re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email) else None


def sanitize_doc_id(value: Optional[str]) -> str:
    if not value:
        return f"doc_{iso_now().replace(':', '-')}"
    cleaned = re.sub(r"[^A-Za-z0-9_\-]", "_", value)[:MAX_DOC_ID_LEN]
    return cleaned or f"doc_{iso_now().replace(':', '-')}"


def validate_topic_arn(arn: Optional[str]) -> Optional[str]:
    if not arn:
        return None
    if arn.startswith(ALLOWED_TOPIC_PREFIX):
        return arn
    logger.warning("Rejected untrusted SNS ARN: %s", arn)
    return None


def strip_extension(filename: str) -> str:
    return re.sub(r"\.[^.]+$", "", filename)


def iso_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
