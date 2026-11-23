"""Load a single product-catalogue PDF into plain text for the agent's context.

Deliberately minimal: no chunking, no embeddings, no vector store. The catalogue
is assumed small enough to sit in the model context, so it is read once at
startup and reused for every request.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import pymupdf

DEFAULT_CATALOG_DIR = "catalog"
DEFAULT_MAX_CHARS = 120_000


class CatalogError(RuntimeError):
    """The catalogue could not be loaded. The message is meant to be read by an operator."""


@dataclass(frozen=True)
class Catalog:
    """Extracted catalogue text plus the identifiers used for citations."""

    filename: str
    path: Path
    page_count: int
    char_count: int
    text: str


def _resolve_dir() -> Path:
    return Path(os.getenv("CATALOG_DIR", DEFAULT_CATALOG_DIR)).expanduser()


def _max_chars() -> int:
    raw = os.getenv("MAX_CATALOG_CHARS", "").strip()
    if not raw:
        return DEFAULT_MAX_CHARS
    try:
        value = int(raw)
    except ValueError:
        raise CatalogError(
            f"MAX_CATALOG_CHARS must be an integer, got {raw!r}."
        ) from None
    if value <= 0:
        raise CatalogError("MAX_CATALOG_CHARS must be greater than 0.")
    return value


def _find_pdf(catalog_dir: Path) -> Path:
    if not catalog_dir.is_dir():
        raise CatalogError(
            f"Catalogue folder not found: {catalog_dir.resolve()}\n"
            "Create the folder and place exactly one product-catalogue PDF inside it."
        )

    pdfs = sorted(
        p for p in catalog_dir.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"
    )
    if not pdfs:
        raise CatalogError(
            f"No PDF found in {catalog_dir.resolve()}\n"
            "Place exactly one product-catalogue PDF in that folder and restart. "
            "The agent has no built-in product data and will not start without a catalogue."
        )
    if len(pdfs) > 1:
        names = ", ".join(p.name for p in pdfs)
        raise CatalogError(
            f"Expected exactly one PDF in {catalog_dir.resolve()}, found {len(pdfs)}: {names}\n"
            "Leave only the catalogue you want the agent to use."
        )
    return pdfs[0]


def load_catalog() -> Catalog:
    """Read the catalogue PDF and return its text with page markers.

    Raises CatalogError with an actionable message when the catalogue is
    missing, unreadable, has no extractable text, or is too large to place in
    the model context.
    """
    catalog_dir = _resolve_dir()
    pdf_path = _find_pdf(catalog_dir)
    limit = _max_chars()

    try:
        document = pymupdf.open(pdf_path)
    except Exception as exc:  # corrupt, encrypted, or not really a PDF
        raise CatalogError(f"Could not open {pdf_path.name}: {exc}") from exc

    with document:
        if document.needs_pass:
            raise CatalogError(
                f"{pdf_path.name} is password protected. Supply an unprotected copy."
            )
        page_count = document.page_count
        sections: list[str] = []
        for index, page in enumerate(document, start=1):
            text = page.get_text("text").strip()
            if text:
                sections.append(f"[{pdf_path.name} | page {index}]\n{text}")

    if not sections:
        raise CatalogError(
            f"{pdf_path.name} contains no extractable text across {page_count} page(s).\n"
            "It is most likely a scanned or image-only PDF. This agent does not perform OCR; "
            "supply a text-based PDF instead."
        )

    body = "\n\n".join(sections)
    if len(body) > limit:
        raise CatalogError(
            f"{pdf_path.name} produced {len(body):,} characters of text, over the "
            f"{limit:,} character limit for the model context.\n"
            "Supply a smaller catalogue, or raise MAX_CATALOG_CHARS if your model's "
            "context window can take it."
        )

    return Catalog(
        filename=pdf_path.name,
        path=pdf_path.resolve(),
        page_count=page_count,
        char_count=len(body),
        text=body,
    )
