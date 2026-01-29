import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StudentClass, StudentClassStatus } from './student-class.entity';

@Injectable()
export class StudentClassService {
  constructor(
    @InjectRepository(StudentClass)
    private studentClassRepository: Repository<StudentClass>,
  ) {}

  // 활성 상태인 반 목록 조회
  async findActiveClasses(): Promise<StudentClass[]> {
    return this.studentClassRepository.find({
      where: { status: StudentClassStatus.ACTIVE },
      order: { name: 'ASC' },
    });
  }

  async findById(id: number): Promise<StudentClass | null> {
    return this.studentClassRepository.findOne({ where: { id } });
  }
}
