import { Global, Module } from '@nestjs/common';
import { RunRegistry } from './run-registry.service';
import { WorkerSignal } from './worker-signal.service';

@Global()
@Module({
  providers: [WorkerSignal, RunRegistry],
  exports: [WorkerSignal, RunRegistry],
})
export class CommonModule {}
