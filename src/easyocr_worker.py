import json
import os
import sys
import contextlib

LANGUAGES = [value.strip() for value in os.environ.get("EASYOCR_LANGUAGES", "en").split(",") if value.strip()]
ALLOWLIST = os.environ.get(
    "EASYOCR_ALLOWLIST",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)
MAX_IMAGE_BYTES = 20 * 1024 * 1024

reader = None
try:
    with contextlib.redirect_stdout(sys.stderr):
        import easyocr

        reader = easyocr.Reader(LANGUAGES or ["en"], gpu=False)
except Exception as error:
    print(json.dumps({"type": "ready", "success": False, "error": str(error)}), flush=True)
    sys.exit(1)

print(json.dumps({"type": "ready", "success": True}), flush=True)


def read_image(image_path):
    if not os.path.isfile(image_path):
        raise FileNotFoundError("Arquivo de imagem inexistente")

    with open(image_path, "rb") as image_file:
        image = image_file.read(MAX_IMAGE_BYTES + 1)
    if not image:
        raise ValueError("Arquivo de imagem vazio")
    if len(image) > MAX_IMAGE_BYTES:
        raise ValueError("Imagem acima do limite permitido")

    with contextlib.redirect_stdout(sys.stderr):
        results = reader.readtext(
            image,
            detail=1,
            paragraph=False,
            allowlist=ALLOWLIST,
        )
    results.sort(key=lambda item: item[0][0][0])
    return "".join(str(item[1]) for item in results)


for line in sys.stdin:
    request = None
    try:
        request = json.loads(line)
        request_id = request["id"]
        image_path = request["image"]
        if not isinstance(image_path, str) or not image_path:
            raise ValueError("Caminho da imagem inválido")

        response = {
            "id": request_id,
            "success": True,
            "text": read_image(image_path),
        }
    except Exception as error:
        response = {
            "id": request.get("id") if isinstance(request, dict) else None,
            "success": False,
            "error": str(error),
        }

    print(json.dumps(response, ensure_ascii=False), flush=True)
