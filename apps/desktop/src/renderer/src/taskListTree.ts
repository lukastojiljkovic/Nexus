import type { TaskList } from "../../shared/ipc.js";

/** One node of the list rail: a list and the lists filed under it. */
export interface TaskListNode {
  list: TaskList;
  children: TaskListNode[];
}

/**
 * The flat `task_lists` rows as the tree they are.
 *
 * A `TaskList` carries a `parentId`, and the store hands the array out in
 * `ORDER BY parent_id, position, id` — an order that is meaningless read
 * straight down, because a child sorts by its parent's id rather than under its
 * parent. The rail has always rebuilt the tree before drawing it; the dashboard
 * widget's own list picker did not, and drew a flat run of names in which two
 * lists called „Privatno" under different parents were indistinguishable.
 *
 * Lifted out of `TasksPage` for that second caller. Inbox first among the roots,
 * which is the rail's own rule and the one place list order is a decision rather
 * than a query.
 */
export function buildTaskListTree(lists: readonly TaskList[]): TaskListNode[] {
  const byParent = new Map<string | null, TaskList[]>();
  for (const list of lists) {
    const siblings = byParent.get(list.parentId);
    if (siblings) siblings.push(list);
    else byParent.set(list.parentId, [list]);
  }
  const build = (parentId: string | null): TaskListNode[] =>
    (byParent.get(parentId) ?? []).map((list) => ({ list, children: build(list.id) }));
  const roots = build(null);
  return [
    ...roots.filter((node) => node.list.isInbox),
    ...roots.filter((node) => !node.list.isInbox),
  ];
}

/** The tree read top to bottom, each row carrying how deep it sits — what an indent needs. */
export function flattenTaskListTree(
  nodes: readonly TaskListNode[],
  depth = 0,
): { list: TaskList; depth: number }[] {
  return nodes.flatMap((node) => [
    { list: node.list, depth },
    ...flattenTaskListTree(node.children, depth + 1),
  ]);
}
