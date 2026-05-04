import { Test, TestingModule } from '@nestjs/testing';
import { CleaningController } from './cleaning.controller';
import { CleaningService } from './cleaning.service';

describe('CleaningController', () => {
  let controller: CleaningController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CleaningController],
      providers: [CleaningService],
    }).compile();

    controller = module.get<CleaningController>(CleaningController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
