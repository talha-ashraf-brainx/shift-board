import { Module } from '@nestjs/common';
import { GitServiceFactory } from './git-service.factory';

/** AppConfig is provided by the global ConfigModule. Use GitServiceFactory.forProject() to get a GitService. */
@Module({
  providers: [GitServiceFactory],
  exports: [GitServiceFactory],
})
export class GitModule {}
