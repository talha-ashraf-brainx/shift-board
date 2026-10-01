import { useState } from 'react';
import type { ProjectDto, RepoInspectDto, UpdateProjectInput } from '@agent-board/shared';
import { useCreateProject, useInspectRepo, useUpdateProject } from '../api/queries';
import { Button } from './Button';
import { Icon } from './Icon';
import { MarkdownField } from './MarkdownField';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';

const NAME_MAX = 100;

/** One tool per line, or comma separated; commas inside parentheses (e.g. `Bash(a, b)`) are kept. */
export function parseTools(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  const flush = () => {
    const t = current.trim();
    if (t && !out.includes(t)) out.push(t);
    current = '';
  };
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '\n' || (ch === ',' && depth === 0)) {
      flush();
      continue;
    }
    current += ch;
  }
  flush();
  return out;
}

function defaultBranch(inspect: RepoInspectDto): string {
  const { branches, currentBranch } = inspect;
  if (currentBranch && branches.includes(currentBranch)) return currentBranch;
  if (branches.includes('main')) return 'main';
  if (branches.includes('master')) return 'master';
  return currentBranch ?? branches[0] ?? '';
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

interface FieldsProps {
  repoPath: string;
  branches: string[];
  branchesLoading?: boolean;
  initial: { name: string; baseBranch: string; rules: string; tools: string };
  busy: boolean;
  submitLabel: string;
  title: string;
  description: string;
  onSubmit: (values: { name: string; baseBranch: string; rules: string | null; tools: string[] }) => void;
  onBack: () => void;
  backLabel: string;
  onClose: () => void;
}

function ProjectFields({
  repoPath,
  branches,
  branchesLoading,
  initial,
  busy,
  submitLabel,
  title,
  description,
  onSubmit,
  onBack,
  backLabel,
  onClose,
}: FieldsProps) {
  const [name, setName] = useState(initial.name);
  const [baseBranch, setBaseBranch] = useState(initial.baseBranch);
  const [rules, setRules] = useState(initial.rules);
  const [tools, setTools] = useState(initial.tools);
  const [submitted, setSubmitted] = useState(false);

  const trimmed = name.trim();
  const nameError = !trimmed ? 'Give the project a name.' : trimmed.length > NAME_MAX ? `Keep it under ${NAME_MAX} characters.` : null;
  const branchError = baseBranch ? null : 'Choose the branch tickets branch off and merge into.';
  const showErrors = submitted;
  const parsedTools = parseTools(tools);

  function submit(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    if (busy) return;
    setSubmitted(true);
    if (nameError || branchError) return;
    onSubmit({ name: trimmed, baseBranch, rules: rules.trim() ? rules : null, tools: parsedTools });
  }

  const formId = 'project-form';
  const options = branches.includes(baseBranch) || !baseBranch ? branches : [baseBranch, ...branches];

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button onClick={onBack} disabled={busy} className="mr-auto">
            {backLabel}
          </Button>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keyboard shortcut for the whole form */}
      <form
        id={formId}
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      >
        <div>
          <p className="mb-1 text-meta font-medium">Repository</p>
          <p
            className="flex items-center gap-2 truncate rounded-control border border-line bg-page px-2.5 py-1.5 font-mono text-[13px] text-muted"
            title={repoPath}
          >
            <Icon name="folder" width={14} height={14} className="shrink-0" />
            <span className="truncate">{repoPath}</span>
          </p>
          <p className="mt-1 text-[12px] text-muted">The repository path can&rsquo;t be changed later.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
          <div>
            <label htmlFor="project-name" className="mb-1 block text-meta font-medium">
              Name<span className="text-red-600"> *</span>
            </label>
            <input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX + 20}
              aria-required="true"
              aria-invalid={showErrors && nameError ? true : undefined}
              aria-describedby="project-name-help"
              data-autofocus
              className="field"
            />
            <p
              id="project-name-help"
              className={showErrors && nameError ? 'mt-1 text-[12px] text-red-600' : 'mt-1 text-[12px] text-muted'}
              role={showErrors && nameError ? 'alert' : undefined}
            >
              {showErrors && nameError ? nameError : 'Shown in the project switcher and on cards. Must be unique.'}
            </p>
          </div>
          <div>
            <label htmlFor="project-branch" className="mb-1 block text-meta font-medium">
              Base branch<span className="text-red-600"> *</span>
            </label>
            <select
              id="project-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              disabled={branchesLoading}
              aria-required="true"
              aria-invalid={showErrors && branchError ? true : undefined}
              aria-describedby="project-branch-help"
              className="field font-mono text-[13px]"
            >
              {options.length === 0 ? <option value="">{branchesLoading ? 'Loading…' : 'No branches found'}</option> : null}
              {options.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <p
              id="project-branch-help"
              className={showErrors && branchError ? 'mt-1 text-[12px] text-red-600' : 'mt-1 text-[12px] text-muted'}
              role={showErrors && branchError ? 'alert' : undefined}
            >
              {showErrors && branchError ? branchError : 'Tickets branch off it; approvals merge into it.'}
            </p>
          </div>
        </div>

        <MarkdownField
          label="Project rules"
          // Rules go into the system prompt as text; the agent would never see an image there.
          images={false}
          value={rules}
          onChange={setRules}
          rows={6}
          placeholder={'- Use pnpm, not npm\n- Run `pnpm test` before finishing'}
          hint="Added after the global rules for every ticket in this project."
        />

        <div>
          <label htmlFor="project-tools" className="mb-1 block text-meta font-medium">
            Extra allowed tools <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="project-tools"
            value={tools}
            onChange={(e) => setTools(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={'Bash(npm test:*)\nBash(npx prisma generate)'}
            aria-describedby="project-tools-help"
            className="field resize-y font-mono text-[13px]"
          />
          <p id="project-tools-help" className="mt-1 text-[12px] text-muted">
            One per line or comma separated. Added to the agent&rsquo;s base tools for this project
            {parsedTools.length > 0 ? ` (${parsedTools.length} tool${parsedTools.length === 1 ? '' : 's'})` : ''}.
          </p>
        </div>
      </form>
    </Modal>
  );
}

interface AddProjectFormProps {
  path: string;
  onBack: () => void;
  onClose: () => void;
  onCreated: (project: ProjectDto) => void;
  onOpenExisting: (id: string) => void;
}

/** Step 2 of "Add project": inspect the folder, then fill in the project details. */
export function AddProjectForm({ path, onBack, onClose, onCreated, onOpenExisting }: AddProjectFormProps) {
  const inspect = useInspectRepo(path);
  const create = useCreateProject();
  const data = inspect.data;

  if (!data || data.error || !data.isGitRepo || !data.repoRoot || data.existingProjectId) {
    const existing = data?.existingProjectId ?? null;
    return (
      <Modal
        title="Add project"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onBack} className="mr-auto">
              Choose another folder
            </Button>
            {existing ? (
              <Button variant="primary" onClick={() => onOpenExisting(existing)}>
                Show that project
              </Button>
            ) : null}
          </>
        }
      >
        {inspect.isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Inspecting the repository">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div role="alert" className="flex items-start gap-2 rounded-control border border-amber-200 bg-amber-50 px-3 py-2.5 text-meta text-amber-900">
            <Icon name="alert" className="mt-px shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-medium">
                {existing
                  ? 'This repository is already a project.'
                  : inspect.isError
                    ? 'Could not inspect this folder.'
                    : 'This folder can’t be added as a project.'}
              </p>
              <p className="mt-0.5 font-mono text-[12px] break-all">{data?.repoRoot ?? path}</p>
              {inspect.isError ? <p className="mt-1">{inspect.error.message}</p> : null}
              {data?.error ? <p className="mt-1">{data.error}</p> : null}
              {data && !data.error && !data.isGitRepo ? <p className="mt-1">It isn&rsquo;t a git repository.</p> : null}
            </div>
          </div>
        )}
      </Modal>
    );
  }

  const repoRoot = data.repoRoot;
  return (
    <ProjectFields
      key={repoRoot}
      title="Add project"
      description="The agent works in worktrees of this repository and merges approved tickets into the base branch."
      repoPath={repoRoot}
      branches={data.branches}
      initial={{ name: data.suggestedName, baseBranch: defaultBranch(data), rules: '', tools: '' }}
      busy={create.isPending}
      submitLabel="Add project"
      backLabel="Back"
      onBack={onBack}
      onClose={onClose}
      onSubmit={(v) =>
        create.mutate(
          { name: v.name, repoPath: repoRoot, baseBranch: v.baseBranch, rules: v.rules, extraAllowedTools: v.tools },
          { onSuccess: onCreated },
        )
      }
    />
  );
}

interface EditProjectFormProps {
  project: ProjectDto;
  onBack: () => void;
  onClose: () => void;
}

export function EditProjectForm({ project, onBack, onClose }: EditProjectFormProps) {
  const inspect = useInspectRepo(project.repoPath);
  const update = useUpdateProject();

  return (
    <ProjectFields
      title={`Edit ${project.name}`}
      description="Changes apply to the next agent run. The repository path is fixed."
      repoPath={project.repoPath}
      branches={inspect.data?.branches ?? []}
      branchesLoading={inspect.isLoading}
      initial={{
        name: project.name,
        baseBranch: project.baseBranch,
        rules: project.rules ?? '',
        tools: project.extraAllowedTools.join('\n'),
      }}
      busy={update.isPending}
      submitLabel="Save project"
      backLabel="Back to projects"
      onBack={onBack}
      onClose={onClose}
      onSubmit={(v) => {
        const input: UpdateProjectInput = {};
        if (v.name !== project.name) input.name = v.name;
        if (v.baseBranch !== project.baseBranch) input.baseBranch = v.baseBranch;
        if (v.rules !== (project.rules?.trim() ? project.rules : null)) input.rules = v.rules;
        if (!sameList(v.tools, project.extraAllowedTools)) input.extraAllowedTools = v.tools;
        if (Object.keys(input).length === 0) {
          onBack();
          return;
        }
        update.mutate({ id: project.id, input }, { onSuccess: onBack });
      }}
    />
  );
}
