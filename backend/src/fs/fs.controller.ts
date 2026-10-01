import type { BrowseDto, BrowseEntryDto } from '@agent-board/shared';
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Trim } from '../common/transformers';

const MAX_ENTRIES = 500;

export class BrowseQueryDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(4096)
  path?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' || value === '1' : value))
  @IsBoolean({ message: 'showHidden must be a boolean' })
  showHidden?: boolean;
}

function hasGit(dir: string): boolean {
  try {
    return existsSync(join(dir, '.git'));
  } catch {
    return false;
  }
}

/** Read-only directory browser for picking a project folder. Directories only. */
@Controller('fs')
export class FsController {
  @Get('browse')
  browse(@Query() query: BrowseQueryDto): BrowseDto {
    const home = homedir();
    const raw = query.path || home;
    if (!isAbsolute(raw)) throw new BadRequestException('path must be absolute');
    const path = resolve(raw);
    let isDir = false;
    try {
      isDir = statSync(path).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) throw new BadRequestException(`Not a directory: ${path}`);

    let names: string[];
    try {
      names = readdirSync(path);
    } catch (e) {
      throw new BadRequestException(`Cannot read ${path}: ${(e as Error).message}`);
    }
    const entries: BrowseEntryDto[] = [];
    for (const name of names) {
      if (!query.showHidden && name.startsWith('.')) continue;
      const full = join(path, name);
      try {
        // statSync follows symlinks, so linked folders are listed too.
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue; // unreadable or broken link
      }
      entries.push({ name, path: full, isGitRepo: hasGit(full) });
    }
    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name));

    const parent = dirname(path);
    return {
      path,
      parent: parent === path ? null : parent,
      home,
      isGitRepo: hasGit(path),
      entries: entries.slice(0, MAX_ENTRIES),
    };
  }
}
