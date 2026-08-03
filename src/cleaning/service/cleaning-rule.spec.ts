/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
import { CleaningRuleService } from './cleaning-rule.service';
import { CleaningRule } from '../entity/cleaning-rule.entity';
import { CleaningRuleUser } from '../entity/cleaning-rule-user.entity';
import { CleaningRuleResource } from '../entity/cleaning-rule-resource.entity';
import { UserService } from '../../user/service/user.service';
import { UserAdminService } from '../../user/service/user-admin.service';
import { UserStatus } from '../../user/user.entity';
import { StudentClassStatus } from '../../student-class/student-class.entity';

describe('CleaningRuleService', () => {
  let service: CleaningRuleService;
  let ruleRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    softDelete: jest.Mock;
  };
  let ruleUserRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let ruleResourceRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let userService: { findBySlackId: jest.Mock };
  let userAdminService: { findFiltered: jest.Mock };

  beforeEach(async () => {
    ruleRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    ruleUserRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    ruleResourceRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    userService = { findBySlackId: jest.fn() };
    userAdminService = { findFiltered: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CleaningRuleService,
        { provide: getRepositoryToken(CleaningRule), useValue: ruleRepo },
        {
          provide: getRepositoryToken(CleaningRuleUser),
          useValue: ruleUserRepo,
        },
        {
          provide: getRepositoryToken(CleaningRuleResource),
          useValue: ruleResourceRepo,
        },
        { provide: UserService, useValue: userService },
        { provide: UserAdminService, useValue: userAdminService },
      ],
    }).compile();

    service = module.get<CleaningRuleService>(CleaningRuleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllWithDetails', () => {
    it('규칙이 없으면 빈 배열을 반환하고 추가 조회를 하지 않는다', async () => {
      ruleRepo.find.mockResolvedValue([]);

      const result = await service.findAllWithDetails();

      expect(result).toEqual([]);
      expect(ruleUserRepo.find).not.toHaveBeenCalled();
      expect(ruleResourceRepo.find).not.toHaveBeenCalled();
    });

    it('규칙별로 담당자와 자원을 매핑해 반환한다', async () => {
      const rules = [
        { id: 1, studentClassId: 10 },
        { id: 2, studentClassId: 20 },
      ];
      const ruleUsers = [
        { id: 100, ruleId: 1, user: { id: 1 } },
        { id: 101, ruleId: 2, user: { id: 2 } },
      ];
      const ruleResources = [
        { id: 200, ruleId: 1, resource: { id: 5 } },
        { id: 201, ruleId: 2, resource: { id: 6 } },
      ];
      ruleRepo.find.mockResolvedValue(rules);
      ruleUserRepo.find.mockResolvedValue(ruleUsers);
      ruleResourceRepo.find.mockResolvedValue(ruleResources);

      const result = await service.findAllWithDetails();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 1,
        ruleUsers: [ruleUsers[0]],
        ruleResource: ruleResources[0],
      });
      expect(result[1]).toMatchObject({
        id: 2,
        ruleUsers: [ruleUsers[1]],
        ruleResource: ruleResources[1],
      });
    });

    it('자원이 없는 규칙은 ruleResource가 undefined가 된다', async () => {
      ruleRepo.find.mockResolvedValue([{ id: 1 }]);
      ruleUserRepo.find.mockResolvedValue([]);
      ruleResourceRepo.find.mockResolvedValue([]);

      const result = await service.findAllWithDetails();

      expect(result[0].ruleResource).toBeUndefined();
      expect(result[0].ruleUsers).toEqual([]);
    });

    it('studentClassId가 주어지면 where 필터로 조회한다', async () => {
      ruleRepo.find.mockResolvedValue([]);

      await service.findAllWithDetails(42);

      expect(ruleRepo.find).toHaveBeenCalledWith({
        where: { studentClassId: 42 },
        relations: ['studentClass'],
        order: { id: 'ASC' },
      });
    });

    it('studentClassId가 없으면 where가 undefined가 된다', async () => {
      ruleRepo.find.mockResolvedValue([]);

      await service.findAllWithDetails();

      expect(ruleRepo.find).toHaveBeenCalledWith({
        where: undefined,
        relations: ['studentClass'],
        order: { id: 'ASC' },
      });
    });

    it('하위 조회는 In(ruleIds) 조건으로 호출된다', async () => {
      ruleRepo.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      ruleUserRepo.find.mockResolvedValue([]);
      ruleResourceRepo.find.mockResolvedValue([]);

      await service.findAllWithDetails();

      expect(ruleUserRepo.find).toHaveBeenCalledWith({
        where: { ruleId: In([1, 2]) },
        relations: ['user'],
      });
      expect(ruleResourceRepo.find).toHaveBeenCalledWith({
        where: { ruleId: In([1, 2]) },
        relations: ['resource'],
      });
    });
  });

  describe('findOneWithDetails', () => {
    it('규칙이 없으면 null을 반환한다', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      const result = await service.findOneWithDetails(1);

      expect(result).toBeNull();
      expect(ruleUserRepo.find).not.toHaveBeenCalled();
    });

    it('규칙·담당자·자원을 합쳐 반환한다', async () => {
      const rule = { id: 1, studentClassId: 10 };
      const ruleUsers = [{ id: 100, ruleId: 1 }];
      const ruleResource = { id: 200, ruleId: 1 };
      ruleRepo.findOne.mockResolvedValue(rule);
      ruleUserRepo.find.mockResolvedValue(ruleUsers);
      ruleResourceRepo.findOne.mockResolvedValue(ruleResource);

      const result = await service.findOneWithDetails(1);

      expect(result).toMatchObject({ id: 1, ruleUsers, ruleResource });
    });

    it('자원이 없으면 ruleResource는 undefined가 된다', async () => {
      ruleRepo.findOne.mockResolvedValue({ id: 1 });
      ruleUserRepo.find.mockResolvedValue([]);
      ruleResourceRepo.findOne.mockResolvedValue(null);

      const result = await service.findOneWithDetails(1);

      expect(result!.ruleResource).toBeUndefined();
    });
  });

  describe('create', () => {
    it('규칙·자원을 저장하고 담당자를 설정한 뒤 규칙을 반환한다', async () => {
      const dto = {
        studentClassId: 10,
        cycle: 7,
        needPeoples: 2,
        daysOfWeek: [1, 3],
        resourceId: 5,
        slackUserIds: [],
      };
      const createdRule = { ...dto };
      const savedRule = { id: 1, ...dto };
      ruleRepo.create.mockReturnValue(createdRule);
      ruleRepo.save.mockResolvedValue(savedRule);
      ruleResourceRepo.create.mockReturnValue({ ruleId: 1, resourceId: 5 });
      ruleResourceRepo.save.mockResolvedValue({});
      ruleUserRepo.delete.mockResolvedValue({});

      const result = await service.create(dto);

      expect(ruleRepo.create).toHaveBeenCalledWith({
        studentClassId: 10,
        cycle: 7,
        needPeoples: 2,
        daysOfWeek: [1, 3],
      });
      expect(ruleRepo.save).toHaveBeenCalledWith(createdRule);
      expect(ruleResourceRepo.create).toHaveBeenCalledWith({
        ruleId: 1,
        resourceId: 5,
      });
      expect(ruleUserRepo.delete).toHaveBeenCalledWith({ ruleId: 1 });
      expect(result).toBe(savedRule);
    });
  });

  describe('update', () => {
    it('기존 자원이 있으면 자원을 update한다', async () => {
      const dto = {
        cycle: 14,
        needPeoples: 3,
        daysOfWeek: [2],
        resourceId: 9,
      };
      ruleRepo.update.mockResolvedValue({});
      ruleResourceRepo.findOne.mockResolvedValue({ id: 200, ruleId: 1 });
      ruleResourceRepo.update.mockResolvedValue({});

      await service.update(1, dto);

      expect(ruleRepo.update).toHaveBeenCalledWith(1, {
        cycle: 14,
        needPeoples: 3,
        daysOfWeek: [2],
      });
      expect(ruleResourceRepo.update).toHaveBeenCalledWith(200, {
        resourceId: 9,
      });
      expect(ruleResourceRepo.save).not.toHaveBeenCalled();
    });

    it('기존 자원이 없으면 자원을 새로 save한다', async () => {
      const dto = {
        cycle: 14,
        needPeoples: 3,
        daysOfWeek: [2],
        resourceId: 9,
      };
      ruleRepo.update.mockResolvedValue({});
      ruleResourceRepo.findOne.mockResolvedValue(null);
      ruleResourceRepo.create.mockReturnValue({ ruleId: 1, resourceId: 9 });
      ruleResourceRepo.save.mockResolvedValue({});

      await service.update(1, dto);

      expect(ruleResourceRepo.create).toHaveBeenCalledWith({
        ruleId: 1,
        resourceId: 9,
      });
      expect(ruleResourceRepo.save).toHaveBeenCalled();
      expect(ruleResourceRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('규칙을 softDelete한다', async () => {
      ruleRepo.softDelete.mockResolvedValue({});

      await service.delete(1);

      expect(ruleRepo.softDelete).toHaveBeenCalledWith(1);
    });
  });

  describe('setUsers', () => {
    it('기존 담당자를 삭제하고, 목록이 비면 저장하지 않는다', async () => {
      ruleUserRepo.delete.mockResolvedValue({});

      await service.setUsers(1, []);

      expect(ruleUserRepo.delete).toHaveBeenCalledWith({ ruleId: 1 });
      expect(userService.findBySlackId).not.toHaveBeenCalled();
      expect(ruleUserRepo.save).not.toHaveBeenCalled();
    });

    it('유효한 유저만 매핑해 저장한다', async () => {
      ruleUserRepo.delete.mockResolvedValue({});
      userService.findBySlackId
        .mockResolvedValueOnce({ id: 11 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 13 });
      ruleUserRepo.create.mockImplementation((v) => v);
      ruleUserRepo.save.mockResolvedValue({});

      await service.setUsers(1, ['U1', 'U2', 'U3']);

      expect(ruleUserRepo.save).toHaveBeenCalledWith([
        { ruleId: 1, userId: 11 },
        { ruleId: 1, userId: 13 },
      ]);
    });

    it('유효한 유저가 한 명도 없으면 저장하지 않는다', async () => {
      ruleUserRepo.delete.mockResolvedValue({});
      userService.findBySlackId.mockResolvedValue(null);

      await service.setUsers(1, ['U1', 'U2']);

      expect(ruleUserRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getUserSlackIds', () => {
    it('담당자들의 slackId 목록을 반환한다', async () => {
      ruleUserRepo.find.mockResolvedValue([
        { user: { slackId: 'U1' } },
        { user: { slackId: 'U2' } },
      ]);

      const result = await service.getUserSlackIds(1);

      expect(result).toEqual(['U1', 'U2']);
      expect(ruleUserRepo.find).toHaveBeenCalledWith({
        where: { ruleId: 1 },
        relations: ['user'],
      });
    });
  });

  describe('getUserOptions', () => {
    it('반과 학번을 포함한 라벨을 만든다', async () => {
      const currentYear = new Date().getFullYear();
      userAdminService.findFiltered.mockResolvedValue({
        users: [
          {
            name: '홍길동',
            code: '20240001',
            slackId: 'U1',
            studentClass: {
              admissionYear: currentYear,
              section: 'A',
              status: StudentClassStatus.ACTIVE,
            },
          },
        ],
      });

      const result = await service.getUserOptions();

      expect(result).toEqual([
        { label: '홍길동 (1학년 A반 | 20240001)', value: 'U1' },
      ]);
    });

    it('졸업반은 졸업 라벨로 표기된다', async () => {
      userAdminService.findFiltered.mockResolvedValue({
        users: [
          {
            name: '김졸업',
            code: '20200001',
            slackId: 'U9',
            studentClass: {
              admissionYear: 2020,
              section: 'B',
              status: StudentClassStatus.GRADUATED,
            },
          },
        ],
      });

      const result = await service.getUserOptions();

      expect(result).toEqual([
        { label: '김졸업 (졸업 B반 (입학 2020) | 20200001)', value: 'U9' },
      ]);
    });

    it('반·학번이 없으면 이름만 라벨로 쓴다', async () => {
      userAdminService.findFiltered.mockResolvedValue({
        users: [
          { name: '이름만', code: null, slackId: 'U2', studentClass: null },
        ],
      });

      const result = await service.getUserOptions();

      expect(result).toEqual([{ label: '이름만', value: 'U2' }]);
    });

    it('studentClassId가 주어지면 status와 함께 필터로 전달한다', async () => {
      userAdminService.findFiltered.mockResolvedValue({ users: [] });

      await service.getUserOptions(7);

      expect(userAdminService.findFiltered).toHaveBeenCalledWith(
        { status: UserStatus.ACTIVE, studentClassId: 7 },
        0,
        1000,
      );
    });

    it('studentClassId가 없으면 status만 필터로 전달한다', async () => {
      userAdminService.findFiltered.mockResolvedValue({ users: [] });

      await service.getUserOptions();

      expect(userAdminService.findFiltered).toHaveBeenCalledWith(
        { status: UserStatus.ACTIVE },
        0,
        1000,
      );
    });
  });
});
