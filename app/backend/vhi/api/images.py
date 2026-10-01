"""Image slots: the stock photos of the ten main vehicles and the scenes, uploads that replace them, and the prompts
to generate them (vhi.services.images). Every logged-in account may look; HQ and the presenter may change them."""
from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse

from ..services import images

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/slots")
def list_slots(group: str | None = None, plate: str | None = None) -> list[dict]:
    """Every image slot (filter by group - a vehicle's slug or "scenes" - or by plate): where it shows, its aspect
    ratio and prompt, the photo it shows now (``current``), the stock photo and whether an upload replaces it."""
    return images.slots(group, plate)


@router.get("/groups")
def list_groups() -> list[dict]:
    """The ten vehicles (plate, make, model, paint, hero photo, slots filled) and then the scenes."""
    return images.groups()


@router.get("/vehicle/{plate}")
def vehicle(plate: str) -> dict:
    """A vehicle's hero photo, gallery and paint (all empty for a vehicle without photos)."""
    return images.vehicle_photos(plate)


@router.get("/scenes")
def scenes() -> dict:
    """{scene id: photo or null} for hub, lane, pit, flood, tyre and login."""
    return images.scenes()


@router.get("/prompts.md", response_class=PlainTextResponse)
def prompts_md() -> PlainTextResponse:
    """Every slot's prompt as one Markdown document, with what each slot shows now."""
    return PlainTextResponse(images.prompts_markdown(status=True), media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": 'inline; filename="vehiclesense-image-prompts.md"'})


@router.post("/slots/{slot_id}")
async def upload(slot_id: str, file: UploadFile = File(...)) -> dict:
    """Use an image (JPEG, PNG or WebP, at most 12 MB) for a slot. It replaces the stock photo."""
    data = await file.read(images.MAX_BYTES + 1)
    try:
        return images.save_upload(slot_id, data, file.content_type)
    except images.ImageError as e:
        raise HTTPException(e.status, str(e)) from e


@router.delete("/slots/{slot_id}")
def revert(slot_id: str) -> dict:
    """Delete a slot's upload: the stock photo shows again."""
    try:
        return images.delete_upload(slot_id)
    except images.ImageError as e:
        raise HTTPException(e.status, str(e)) from e
