import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { McpService } from './mcp/mcp.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: McpService,
          useValue: {
            getAuthorizationServerMetadata: jest.fn(),
            getProtectedResourceMetadata: jest.fn(),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('health', () => {
    it('should return health info from the app service', () => {
      expect(appController.getHealth()).toEqual(appService.getHealthInfo());
    });
  });
});
