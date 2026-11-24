/** Reads a .sql file. SSMS often saves UTF-16 with a BOM, so detect that instead of assuming UTF-8. */
export async function readSqlFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  let enc = 'utf-8';
  if (b[0] === 0xff && b[1] === 0xfe) enc = 'utf-16le';
  else if (b[0] === 0xfe && b[1] === 0xff) enc = 'utf-16be';
  return new TextDecoder(enc).decode(buf).replace(/^\uFEFF/, '');
}
