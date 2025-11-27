from pathlib import Path
from io import BytesIO
from typing import Literal

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from PIL import Image, ImageEnhance, ImageOps, ImageFilter

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"
R = getattr(Image, "Resampling", Image)

app = FastAPI(title="Mini Editor")
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def pad_to_square(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    side = max(w, h)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - w) // 2, (side - h) // 2))
    return out


def apply_ops(img: Image.Image, p: dict) -> Image.Image:
    img = img.convert("RGBA")

    # ???�사�? ?�라?�기 X, ?�딩?�로 ?�사각화
    if p["crop_square"]:
        img = pad_to_square(img)

    if p["flip_h"]:
        img = ImageOps.mirror(img)
    if p["flip_v"]:
        img = ImageOps.flip(img)

    if p["rotate"]:
        img = img.rotate(p["rotate"], expand=True, resample=R.BICUBIC)

    if p["scale"] != 1:
        w, h = img.size
        img = img.resize((max(1, int(w * p["scale"])), max(1, int(h * p["scale"]))), R.LANCZOS)

    if p["brightness"] != 1:
        img = ImageEnhance.Brightness(img).enhance(p["brightness"])
    if p["contrast"] != 1:
        img = ImageEnhance.Contrast(img).enhance(p["contrast"])
    if p["saturation"] != 1:
        img = ImageEnhance.Color(img).enhance(p["saturation"])
    if p["sharpness"] != 1:
        img = ImageEnhance.Sharpness(img).enhance(p["sharpness"])

    if p["blur"]:
        img = img.filter(ImageFilter.GaussianBlur(p["blur"]))

    if p["grayscale"]:
        img = ImageOps.grayscale(img).convert("RGBA")

    if p["invert"]:
        rgb = ImageOps.invert(img.convert("RGB"))
        img = rgb.convert("RGBA")

    return img


@app.post("/api/render")
async def render(
    file: UploadFile = File(...),

    fmt: Literal["png", "jpeg", "webp"] = Form("png"),
    quality: int = Form(92),

    flip_h: bool = Form(False),
    flip_v: bool = Form(False),
    rotate: float = Form(0),
    scale: float = Form(1),

    brightness: float = Form(1),
    contrast: float = Form(1),
    saturation: float = Form(1),
    sharpness: float = Form(1),

    blur: float = Form(0),
    grayscale: bool = Form(False),
    invert: bool = Form(False),
    crop_square: bool = Form(False),
):
    data = await file.read()
    img = Image.open(BytesIO(data))

    p = dict(
        flip_h=flip_h,
        flip_v=flip_v,
        rotate=clamp(float(rotate), -180, 180),
        scale=clamp(float(scale), 0.05, 5.0),

        brightness=clamp(float(brightness), 0.0, 3.0),
        contrast=clamp(float(contrast), 0.0, 3.0),
        saturation=clamp(float(saturation), 0.0, 3.0),
        sharpness=clamp(float(sharpness), 0.0, 4.0),

        blur=clamp(float(blur), 0.0, 20.0),
        grayscale=grayscale,
        invert=invert,
        crop_square=crop_square,
    )

    out = apply_ops(img, p)
    buf = BytesIO()
    q = int(clamp(int(quality), 1, 100))

    if fmt == "jpeg":
        if out.mode == "RGBA":
            bg = Image.new("RGB", out.size, (255, 255, 255))
            bg.paste(out, mask=out.split()[-1])
            out = bg
        else:
            out = out.convert("RGB")
        out.save(buf, "JPEG", quality=q, optimize=True)
        media, ext = "image/jpeg", "jpg"
    elif fmt == "webp":
        out.save(buf, "WEBP", quality=q, method=6)
        media, ext = "image/webp", "webp"
    else:
        out.save(buf, "PNG", optimize=True)
        media, ext = "image/png", "png"

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="edited.{ext}"'},
    )

from pathlib import Path
from io import BytesIO

from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from PIL import Image, ImageEnhance, ImageOps, ImageFilter

BASE = Path(__file__).resolve().parent
STATIC = BASE / "static"

app = FastAPI(title="Mini Editor")
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def pad_to_square(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    side = max(w, h)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(img, ((side - w) // 2, (side - h) // 2))
    return out


def apply_ops(img: Image.Image, p: dict) -> Image.Image:
    img = img.convert("RGBA")

    # ?�사�? "?�라?�기"가 ?�니??"?�딩"?�로 ?�사각화(?�용 보존)
    if p["crop_square"]:
        img = pad_to_square(img)

    if p["flip_h"]:
        img = ImageOps.mirror(img)
    if p["flip_v"]:
        img = ImageOps.flip(img)

    rot = p["rotate"]
    if rot:
        img = img.rotate(rot, expand=True, resample=Image.BICUBIC)

    if p["scale"] != 1:
        w, h = img.size
        img = img.resize((max(1, int(w * p["scale"])), max(1, int(h * p["scale"]))), Image.LANCZOS)

    if p["brightness"] != 1:
        img = ImageEnhance.Brightness(img).enhance(p["brightness"])
    if p["contrast"] != 1:
        img = ImageEnhance.Contrast(img).enhance(p["contrast"])
    if p["saturation"] != 1:
        img = ImageEnhance.Color(img).enhance(p["saturation"])
    if p["sharpness"] != 1:
        img = ImageEnhance.Sharpness(img).enhance(p["sharpness"])

    if p["blur"]:
        img = img.filter(ImageFilter.GaussianBlur(p["blur"]))

    if p["grayscale"]:
        img = ImageOps.grayscale(img).convert("RGBA")

    if p["invert"]:
        rgb = ImageOps.invert(img.convert("RGB"))
        img = rgb.convert("RGBA")

    return img


@app.post("/api/render")
async def render(
    file: UploadFile = File(...),
    fmt: str = Form("png"),
    quality: int = Form(92),

    flip_h: bool = Form(False),
    flip_v: bool = Form(False),
    rotate: float = Form(0),
    scale: float = Form(1),

    brightness: float = Form(1),
    contrast: float = Form(1),
    saturation: float = Form(1),
    sharpness: float = Form(1),

    blur: float = Form(0),
    grayscale: bool = Form(False),
    invert: bool = Form(False),
    crop_square: bool = Form(False),
):
    data = await file.read()
    img = Image.open(BytesIO(data))

    p = dict(
        flip_h=flip_h,
        flip_v=flip_v,
        rotate=clamp(float(rotate), -180.0, 180.0),
        scale=clamp(float(scale), 0.05, 5.0),

        brightness=clamp(float(brightness), 0.0, 3.0),
        contrast=clamp(float(contrast), 0.0, 3.0),
        saturation=clamp(float(saturation), 0.0, 3.0),
        sharpness=clamp(float(sharpness), 0.0, 4.0),

        blur=clamp(float(blur), 0.0, 20.0),
        grayscale=bool(grayscale),
        invert=bool(invert),
        crop_square=bool(crop_square),
    )

    out = apply_ops(img, p)

    buf = BytesIO()
    q = int(clamp(int(quality), 1, 100))
    fmt = (fmt or "png").lower()

    if fmt == "jpeg" or fmt == "jpg":
        # RGBA -> RGB (?�명?� ?�색 바탕)
        if out.mode == "RGBA":
            bg = Image.new("RGB", out.size, (255, 255, 255))
            bg.paste(out, mask=out.split()[-1])
            out = bg
        else:
            out = out.convert("RGB")
        out.save(buf, "JPEG", quality=q, optimize=True)
        media, ext = "image/jpeg", "jpg"

    elif fmt == "webp":
        out.save(buf, "WEBP", quality=q, method=6)
        media, ext = "image/webp", "webp"

    else:
        out.save(buf, "PNG", optimize=True)
        media, ext = "image/png", "png"

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="edited.{ext}"'},
    )
