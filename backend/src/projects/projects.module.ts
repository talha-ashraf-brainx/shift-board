import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GitModule } from '../git/git.module';
import { TicketEntity } from '../tickets/ticket.entity';
import { ProjectEntity } from './project.entity';
import { WorktreeEntity } from './worktree.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { WorktreesService } from './worktrees.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, WorktreeEntity, TicketEntity]), GitModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, WorktreesService],
  exports: [ProjectsService, WorktreesService],
})
export class ProjectsModule {}
