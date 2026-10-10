/** 由昵称派生头像底色：同一昵称颜色稳定（无需上传头像） */
export function avatarColor(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return `hsl(${hash} 35% 32%)`;
}