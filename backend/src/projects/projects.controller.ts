import type { ProjectDto, RepoInspectDto } from '@agent-board/shared';
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CreateProjectDto, InspectQueryDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

const Id = () => Param('id', new ParseUUIDPipe({ version: undefined }));

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

  @Delete(':id')
  remove(@Id() id: string): Promise<{ id: string }> {
    return this.projects.remove(id);
  }
}
