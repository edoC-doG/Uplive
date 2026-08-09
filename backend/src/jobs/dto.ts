import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, Min, ValidateNested } from 'class-validator';

// Caps the size of the ffmpeg filter graph (each clip adds a trim + xfade
// pair on the fade/slide path) so a pathological request can't tie up the
// single export worker for the full 5-minute timeout before failing.
const MAX_CLIPS = 20;

class ClipDto {
  @IsNumber() @Min(0) start!: number;
  @IsNumber() @Min(0) end!: number;
}

export class CreateExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CLIPS)
  @ValidateNested({ each: true })
  @Type(() => ClipDto)
  clips!: ClipDto[];

  @IsArray()
  @IsIn(['cut', 'fade', 'slide'], { each: true })
  transitions!: ('cut' | 'fade' | 'slide')[];
}
