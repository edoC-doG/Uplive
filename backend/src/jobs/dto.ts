import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, Min, ValidateNested } from 'class-validator';

class ClipDto {
  @IsNumber() @Min(0) start!: number;
  @IsNumber() @Min(0) end!: number;
}

export class CreateExportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ClipDto)
  clips!: ClipDto[];

  @IsArray()
  @IsIn(['cut', 'fade', 'slide'], { each: true })
  transitions!: ('cut' | 'fade' | 'slide')[];
}
