export function parseCsv(text) {
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  const input = String(text).replace(/^\uFEFF/, "");
  const finishRecord = () => {
    record.push(field);
    if (record.some((value) => value.trim())) records.push(record);
    record = [];
    field = "";
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      finishRecord();
    } else {
      field += char;
    }
  }
  if (field || record.length) finishRecord();
  const headers = records.shift() || [];
  return records.map((cells) => Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""])));
}
