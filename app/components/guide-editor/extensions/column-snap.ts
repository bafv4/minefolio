// 列幅リサイズのスナップ。ドラッグ確定時、新しい列幅が同じテーブルの既存の
// 列幅とほぼ一致（±SNAP_TOLERANCE_PX）する場合、その幅にぴったり揃える。
//
// prosemirror-tables の columnResizing はドラッグ中は DOM の col 幅だけを更新し、
// mouseup で colwidth 属性を確定する 1 つのトランザクションを発行する
// （このとき plugin state にはまだ dragging が残っている）。ここを appendTransaction で
// 捉え、確定値をスナップ先へ書き換える。ドラッグ以外の colwidth 変更（undo・
// テンプレ挿入等）には反応しない。
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TableMap, columnResizingPluginKey } from "@tiptap/pm/tables";

/** スナップの許容誤差（px） */
export const SNAP_TOLERANCE_PX = 8;

const snapKey = new PluginKey("tableColumnSnap");

/**
 * 既存列幅の中から newWidth に最も近いスナップ先を返す。
 * 許容誤差の外・完全一致（スナップ不要）の場合は null。
 */
export function findSnapTarget(
  existing: number[],
  newWidth: number,
  tolerance: number = SNAP_TOLERANCE_PX,
): number | null {
  let best: number | null = null;
  let bestDiff = tolerance + 1;
  for (const w of existing) {
    const diff = Math.abs(w - newWidth);
    if (diff > 0 && diff <= tolerance && diff < bestDiff) {
      best = w;
      bestDiff = diff;
    }
  }
  return best;
}

/** 各列の確定幅（colwidth 属性）を返す。未指定の列は null */
function columnWidths(table: PMNode, map: TableMap): (number | null)[] {
  const widths: (number | null)[] = [];
  for (let col = 0; col < map.width; col++) {
    let width: number | null = null;
    for (let row = 0; row < map.height; row++) {
      const pos = map.map[row * map.width + col];
      const cell = table.nodeAt(pos);
      if (!cell) continue;
      const colwidth = cell.attrs.colwidth as number[] | null;
      if (colwidth) {
        const value = colwidth[col - map.colCount(pos)];
        if (value) {
          width = value;
          break;
        }
      }
    }
    widths.push(width);
  }
  return widths;
}

/** 指定列の colwidth を width へ更新する（prosemirror-tables の updateColumnWidth と同じ走査） */
function setColumnWidth(
  tr: Transaction,
  table: PMNode,
  tableStart: number,
  map: TableMap,
  col: number,
  width: number,
): void {
  for (let row = 0; row < map.height; row++) {
    const mapIndex = row * map.width + col;
    // rowspan で上の行と同じセルを指す場合は一度だけ処理する
    if (row && map.map[mapIndex] === map.map[mapIndex - map.width]) continue;
    const pos = map.map[mapIndex];
    const cell = table.nodeAt(pos);
    if (!cell) continue;
    const index = cell.attrs.colspan === 1 ? 0 : col - map.colCount(pos);
    const current = cell.attrs.colwidth as number[] | null;
    if (current && current[index] === width) continue;
    const colwidth = current
      ? current.slice()
      : (new Array(cell.attrs.colspan).fill(0) as number[]);
    colwidth[index] = width;
    tr.setNodeMarkup(tableStart + pos, undefined, { ...cell.attrs, colwidth });
  }
}

export function columnSnapPlugin(): Plugin {
  return new Plugin({
    key: snapKey,
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some((tr) => tr.docChanged)) return null;
      // 自分のスナップ tr への再反応（連鎖スナップ）を防ぐ
      if (transactions.some((tr) => tr.getMeta(snapKey))) return null;
      // ドラッグ確定の tr のみ対象: columnResizing は幅確定の時点でまだ dragging を保持している。
      // dragging は「初期・列境界ホバー時 = false / ドラッグ中 = {startX,startWidth} /
      // 確定後 = null」の3値なので、truthy 判定でホバー状態（false）も除外する
      const resizing = columnResizingPluginKey.getState(oldState) as
        | { activeHandle: number; dragging: unknown }
        | undefined;
      if (!resizing || !resizing.dragging || resizing.activeHandle < 0) return null;

      // ドラッグ中のセル位置を確定 tr 越しにマップして解決する
      let handle = resizing.activeHandle;
      for (const tr of transactions) handle = tr.mapping.map(handle);
      if (handle > newState.doc.content.size) return null;
      const $cell = newState.doc.resolve(handle);
      const cellNode = $cell.nodeAfter;
      const role = cellNode?.type.spec.tableRole;
      if (!cellNode || (role !== "cell" && role !== "header_cell")) return null;

      const table = $cell.node(-1);
      if (table.type.spec.tableRole !== "table") return null;
      const tableStart = $cell.start(-1);
      const map = TableMap.get(table);

      // ドラッグしたのはセル右端の列
      const col = map.colCount($cell.pos - tableStart) + cellNode.attrs.colspan - 1;
      const widths = columnWidths(table, map);
      const newWidth = widths[col];
      if (newWidth == null) return null;

      // この transactions 群が実際にドラッグ列の幅を変更していなければ反応しない
      // （ドラッグ中のキー入力・非同期挿入など、確定 tr 以外の doc 変更を除外する）
      if (resizing.activeHandle <= oldState.doc.content.size) {
        const $oldCell = oldState.doc.resolve(resizing.activeHandle);
        const oldCellNode = $oldCell.nodeAfter;
        const oldRole = oldCellNode?.type.spec.tableRole;
        if (oldCellNode && (oldRole === "cell" || oldRole === "header_cell")) {
          const oldTable = $oldCell.node(-1);
          if (oldTable.type.spec.tableRole === "table") {
            const oldMap = TableMap.get(oldTable);
            const oldCol =
              oldMap.colCount($oldCell.pos - $oldCell.start(-1)) + oldCellNode.attrs.colspan - 1;
            if (columnWidths(oldTable, oldMap)[oldCol] === newWidth) return null;
          }
        }
      }

      const target = findSnapTarget(
        widths.filter((w, i): w is number => i !== col && w != null),
        newWidth,
      );
      if (target == null) return null;

      const tr = newState.tr;
      setColumnWidth(tr, table, tableStart, map, col, target);
      if (!tr.steps.length) return null;
      tr.setMeta(snapKey, true);
      return tr;
    },
  });
}
