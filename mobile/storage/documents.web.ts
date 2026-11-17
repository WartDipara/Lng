export async function pickJson(): Promise<{ name: string; text: string }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.onchange = async () =>
      resolve(
        await Promise.all(
          Array.from(input.files ?? []).map(async (f) => ({ name: f.name, text: await f.text() })),
        ),
      );
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
export async function exportJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
