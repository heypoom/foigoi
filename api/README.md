
## LoRA diagnostics

Open `/healthz?debug=true` to inspect the resident text-to-image pipeline without
loading an adapter or generating an image. The `lora` object reports the staged
weight file's SHA-256, loaded and active adapter names, enabled layer counts, and
scaling range. `applied: true` means the named Chua Mia Tee adapter is active on
all of its LoRA layers with nonzero scaling. `status: mismatch` indicates that
actual layer state disagrees with the application's load/unload state.

The LoRA is used by P3/P3B. `status: inactive` is normal after startup or another
program runs. Run P3/P3B and check again to verify it is active. These diagnostics
confirm adapter configuration; they do not judge the generated image's style.
