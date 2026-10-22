/**
 * Which of a pack's graphs keep their weights outside the `.onnx` file, and in
 * how many files.
 *
 * ONNX holds a graph of 2 GiB or more only with its tensors in separate files,
 * and a release asset must stay under 2 GiB, so the 3.3B decoder's weights come
 * in two (`docs/packs/nllb.md`): `<graph>_data` and `<graph>_data_1`.
 * `@huggingface/transformers` loads them only when `use_external_data_format`
 * names the graph's file with that count, so the count is read from the files
 * the pack holds rather than written down per size.
 */
export function externalDataFormat(files: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    const graph = /^(.+\.onnx)_data(?:_\d+)?$/.exec(file)?.[1];
    if (graph !== undefined) counts[graph] = (counts[graph] ?? 0) + 1;
  }
  return counts;
}
