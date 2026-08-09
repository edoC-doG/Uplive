import { IsString } from 'class-validator';

export class CreateVideoDto {
  @IsString()
  url!: string;
}
