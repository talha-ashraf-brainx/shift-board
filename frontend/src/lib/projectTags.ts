import { createContext, useContext } from 'react';

/**
 * Project names by id, provided by the board in "All projects" mode so cards can show
 * a project tag. null when a single project is selected (no tag needed).
 */
export const ProjectTagsContext = createContext<ReadonlyMap<string, string> | null>(null);

export function useProjectTag(projectId: string | null): string | null {
  const tags = useContext(ProjectTagsContext);
  if (!tags) return null;
  if (!projectId) return 'No project';
  return tags.get(projectId) ?? null;
}
