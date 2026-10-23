"""Splits an ONNX model's external data into files a release asset can hold.

GitHub refuses a release asset of 2 GiB or more, and the 3.3B decoder's q8
weights are one 2.67 GB file. This rewrites the model so its tensors live in
`<model>.onnx_data`, `<model>.onnx_data_1`, ... - the names
`@huggingface/transformers` loads when `use_external_data_format` is the chunk
count - each under the limit, and writes the result to a new folder. The
tensors' bytes are copied unchanged; only where each is stored moves.

    python split-external-data.py <model.onnx> <out-dir> [--limit BYTES]

Run it with the conversion's own venv (it needs `onnx`). It reads the source
model's external data by offset, so it never holds the weights in memory.
"""

import argparse
import os
import sys

import onnx
from onnx.external_data_helper import _get_all_tensors, uses_external_data

# Under 2 GiB with room to spare; offsets are aligned to Windows' allocation
# granularity, so a runtime may map a tensor rather than copy it.
DEFAULT_LIMIT = 1_900_000_000
ALIGN = 65_536


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model")
    parser.add_argument("out_dir")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args()

    source_dir = os.path.dirname(os.path.abspath(args.model))
    name = os.path.basename(args.model)
    os.makedirs(args.out_dir, exist_ok=True)
    model = onnx.load(args.model, load_external_data=False)

    chunks: list = []
    sizes: list = []
    sources: dict = {}

    def open_chunk() -> None:
        location = f"{name}_data" if not chunks else f"{name}_data_{len(chunks)}"
        chunks.append((location, open(os.path.join(args.out_dir, location), "wb")))
        sizes.append(0)

    open_chunk()
    moved = 0
    for tensor in _get_all_tensors(model):
        if not uses_external_data(tensor):
            continue
        info = {entry.key: entry.value for entry in tensor.external_data}
        offset = int(info.get("offset", 0))
        length = int(info["length"])
        if length > args.limit:
            print(f"{tensor.name} alone is {length} bytes, over the limit", file=sys.stderr)
            return 1
        start = -(-sizes[-1] // ALIGN) * ALIGN
        if start + length > args.limit:
            open_chunk()
            start = 0
        location, out = chunks[-1]
        out.seek(start)
        source = sources.get(info["location"])
        if source is None:
            source = sources[info["location"]] = open(os.path.join(source_dir, info["location"]), "rb")
        source.seek(offset)
        remaining = length
        while remaining > 0:
            block = source.read(min(remaining, 64 * 1024 * 1024))
            if not block:
                print(f"{info['location']} ends inside {tensor.name}", file=sys.stderr)
                return 1
            out.write(block)
            remaining -= len(block)
        sizes[-1] = start + length
        # Rewritten in place: the tensor already points outside the model, and only
        # where it points changes (onnx's `set_external_data` wants raw bytes in hand).
        del tensor.external_data[:]
        for key, value in (("location", location), ("offset", str(start)), ("length", str(length))):
            entry = tensor.external_data.add()
            entry.key = key
            entry.value = value
        moved += 1

    for _, out in chunks:
        out.close()
    for source in sources.values():
        source.close()
    onnx.save(model, os.path.join(args.out_dir, name))
    for (location, _), size in zip(chunks, sizes):
        print(f"{location}\t{size}")
    print(f"{moved} tensors in {len(chunks)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
