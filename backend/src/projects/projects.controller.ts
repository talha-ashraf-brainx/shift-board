import type { ProjectDto, RepoInspectDto } from '@agent-board/shared';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateProjectDto, CreateWorktreeDto, InspectQueryDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

const Id = () => Param('id', new ParseUUIDPipe({ version: undefined }));
const WorktreeId = () => Param('worktreeId', new ParseUUIDPipe({ version: undefined }));

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<ProjectDto[]> {
    return this.projects.list();
  }

  /** Declared before `:id` so "inspect" is not parsed as an id. */
  @Get('inspect')
  inspect(@Query() query: InspectQueryDto): Promise<RepoInspectDto> {
    return this.projects.inspect(query.path);
  }

  @Post()
  create(@Body() body: CreateProjectDto): Promise<ProjectDto> {
    return this.projects.create(body);
  }

  @Get(':id')
  get(@Id() id: string): Promise<ProjectDto> {
    return this.projects.get(id);
  }

  @Patch(':id')
  update(@Id() id: string, @Body() body: UpdateProjectDto): Promise<ProjectDto> {
    return this.projects.update(id, body);
  }

  @Post(':id/worktrees')
  addWorktree(@Id() id: string, @Body() body: CreateWorktreeDto): Promise<ProjectDto> {
    return this.projects.addWorktree(id, body.name);
  }

  /** Makes the worktree the one new tickets run in. */
  @Post(':id/worktrees/:worktreeId/activate')
  activateWorktree(@Id() id: string, @WorktreeId() worktreeId: string): Promise<ProjectDto> {
    return this.projects.activateWorktree(id, worktreeId);
  }

  @Delete(':id/worktrees/:worktreeId')
  removeWorktree(@Id() id: string, @WorktreeId() worktreeId: string): Promise<ProjectDto> {
    return this.projects.removeWorktree(id, worktreeId);
  }

  @Delete(':id')
  remove(@Id() id: string): Promise<{ id: string }> {
    return this.projects.remove(id);
  }
}
