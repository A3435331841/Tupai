// File 对象无法经 URL 跨路由传递，首页转场结束后用它把照片交给创作台。
let pendingFile: File | null = null;

export function setPendingFile(file: File | null): void {
  pendingFile = file;
}

export function takePendingFile(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
