/**
 * LIKE のワイルドカード(%,_)とエスケープ文字(\)を無害化し、入力を部分一致リテラルとして扱えるようにする。
 * 使うときは `sql\`${col} LIKE ${pattern} ESCAPE '\\'\`` と組み合わせる。
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
