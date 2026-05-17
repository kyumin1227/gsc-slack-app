import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CleaningRule } from './cleaning-rule.entity';
import { CleaningRuleUser } from './cleaning-rule-user.entity';
import { CleaningRuleResource } from './cleaning-rule-resource.entity';
import { UserService } from '../user/service/user.service';
import { UserAdminService } from '../user/service/user-admin.service';
import { UserStatus } from '../user/user.entity';
import { StudentClassStatus } from '../student-class/student-class.entity';
import { formatClassLabel } from '../common/class-label.util';

export interface CreateRuleDto {
  studentClassId: number;
  cycle: number;
  needPeoples: number;
  dayOfWeek: number;
  resourceId: number;
  slackUserIds: string[];
}

export interface UpdateRuleDto {
  cycle: number;
  needPeoples: number;
  dayOfWeek: number;
  resourceId: number;
}

export interface RuleWithDetails extends CleaningRule {
  ruleUsers: CleaningRuleUser[];
  ruleResource: CleaningRuleResource | undefined;
}

@Injectable()
export class CleaningRuleService {
  constructor(
    @InjectRepository(CleaningRule)
    private readonly ruleRepo: Repository<CleaningRule>,
    @InjectRepository(CleaningRuleUser)
    private readonly ruleUserRepo: Repository<CleaningRuleUser>,
    @InjectRepository(CleaningRuleResource)
    private readonly ruleResourceRepo: Repository<CleaningRuleResource>,
    private readonly userService: UserService,
    private readonly userAdminService: UserAdminService,
  ) {}

  async findAllWithDetails(studentClassId?: number): Promise<RuleWithDetails[]> {
    const rules = await this.ruleRepo.find({
      where: studentClassId ? { studentClassId } : undefined,
      relations: ['studentClass'],
      order: { id: 'ASC' },
    });

    if (rules.length === 0) return [];

    const ruleIds = rules.map((r) => r.id);

    const [ruleUsers, ruleResources] = await Promise.all([
      this.ruleUserRepo.find({
        where: { ruleId: In(ruleIds) },
        relations: ['user'],
      }),
      this.ruleResourceRepo.find({
        where: { ruleId: In(ruleIds) },
        relations: ['resource'],
      }),
    ]);

    return rules.map((rule) => ({
      ...rule,
      ruleUsers: ruleUsers.filter((ru) => ru.ruleId === rule.id),
      ruleResource: ruleResources.find((rr) => rr.ruleId === rule.id),
    }));
  }

  async findOneWithDetails(id: number): Promise<RuleWithDetails | null> {
    const rule = await this.ruleRepo.findOne({
      where: { id },
      relations: ['studentClass'],
    });
    if (!rule) return null;

    const [ruleUsers, ruleResource] = await Promise.all([
      this.ruleUserRepo.find({ where: { ruleId: id }, relations: ['user'] }),
      this.ruleResourceRepo.findOne({
        where: { ruleId: id },
        relations: ['resource'],
      }),
    ]);

    return { ...rule, ruleUsers, ruleResource: ruleResource ?? undefined };
  }

  async create(dto: CreateRuleDto): Promise<CleaningRule> {
    const rule = await this.ruleRepo.save(
      this.ruleRepo.create({
        studentClassId: dto.studentClassId,
        cycle: dto.cycle,
        needPeoples: dto.needPeoples,
        dayOfWeek: dto.dayOfWeek,
      }),
    );

    await this.ruleResourceRepo.save(
      this.ruleResourceRepo.create({
        ruleId: rule.id,
        resourceId: dto.resourceId,
      }),
    );

    await this.setUsers(rule.id, dto.slackUserIds);

    return rule;
  }

  async update(id: number, dto: UpdateRuleDto): Promise<void> {
    await this.ruleRepo.update(id, {
      cycle: dto.cycle,
      needPeoples: dto.needPeoples,
      dayOfWeek: dto.dayOfWeek,
    });

    const existing = await this.ruleResourceRepo.findOne({
      where: { ruleId: id },
    });
    if (existing) {
      await this.ruleResourceRepo.update(existing.id, {
        resourceId: dto.resourceId,
      });
    } else {
      await this.ruleResourceRepo.save(
        this.ruleResourceRepo.create({ ruleId: id, resourceId: dto.resourceId }),
      );
    }
  }

  async delete(id: number): Promise<void> {
    await this.ruleRepo.softDelete(id);
  }

  async setUsers(ruleId: number, slackUserIds: string[]): Promise<void> {
    await this.ruleUserRepo.delete({ ruleId });

    if (slackUserIds.length === 0) return;

    const users = await Promise.all(
      slackUserIds.map((slackId) => this.userService.findBySlackId(slackId)),
    );

    const validUsers = users.filter(Boolean);
    if (validUsers.length === 0) return;

    await this.ruleUserRepo.save(
      validUsers.map((user) =>
        this.ruleUserRepo.create({ ruleId, userId: user!.id }),
      ),
    );
  }

  async getUserSlackIds(ruleId: number): Promise<string[]> {
    const ruleUsers = await this.ruleUserRepo.find({
      where: { ruleId },
      relations: ['user'],
    });
    return ruleUsers.map((ru) => ru.user.slackId);
  }

  async getUserOptions(
    studentClassId?: number,
  ): Promise<{ label: string; value: string }[]> {
    const { users } = await this.userAdminService.findFiltered(
      { status: UserStatus.ACTIVE, ...(studentClassId ? { studentClassId } : {}) },
      0,
      1000,
    );
    return users.map((u) => {
      const classLabel = u.studentClass
        ? formatClassLabel({
            admissionYear: u.studentClass.admissionYear,
            section: u.studentClass.section,
            graduated:
              u.studentClass.status === StudentClassStatus.GRADUATED,
          })
        : null;
      const parts = [classLabel, u.code].filter(Boolean).join(' | ');
      const label = parts ? `${u.name} (${parts})` : u.name;
      return { label, value: u.slackId };
    });
  }
}
