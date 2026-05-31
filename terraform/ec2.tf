# SSM 사용을 위한 EC2 IAM 역할
resource "aws_iam_role" "monitoring_ec2" {
  name = "${local.name_prefix}-monitoring-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "monitoring_ssm" {
  role       = aws_iam_role.monitoring_ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Prometheus aws_sd_configs가 ECS 태스크를 탐색하기 위한 권한
# + Grafana 비밀번호를 Secrets Manager에서 읽기 위한 권한
resource "aws_iam_role_policy" "monitoring_prometheus_sd" {
  name = "${local.name_prefix}-prometheus-sd-policy"
  role = aws_iam_role.monitoring_ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:ListClusters",
          "ecs:ListServices",
          "ecs:ListTasks",
          "ecs:DescribeClusters",
          "ecs:DescribeServices",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
          "ec2:DescribeInstances",
          "ec2:DescribeAvailabilityZones",
          "ec2:DescribeNetworkInterfaces"
        ]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.secrets_arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "monitoring_ec2" {
  name = "${local.name_prefix}-monitoring-ec2-profile"
  role = aws_iam_role.monitoring_ec2.name
}

# EC2 보안 그룹 — inline ingress 없이 별도 rule로 관리 (inline + rule 혼용 시 충돌)
resource "aws_security_group" "monitoring" {
  name        = "${local.name_prefix}-monitoring-sg"
  description = "Monitoring EC2 security group"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-monitoring-sg"
  }
}

# 최신 Amazon Linux 2023 AMI (SSM Agent 기본 포함)
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_instance" "monitoring" {
  ami                         = var.monitoring_ami_id
  instance_type               = var.monitoring_instance_type
  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.monitoring.id]
  iam_instance_profile        = aws_iam_instance_profile.monitoring_ec2.name
  key_name                    = var.monitoring_key_name
  associate_public_ip_address = true

  user_data = <<-EOF
    #!/bin/bash
    dnf update -y
    dnf install -y docker git

    # Docker 설정
    systemctl enable docker
    systemctl start docker
    usermod -aG docker ec2-user

    # Docker Compose 설치 (standalone + plugin 심링크)
    curl -L "https://github.com/docker/compose/releases/download/v2.36.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    mkdir -p /usr/libexec/docker/cli-plugins
    ln -sf /usr/local/bin/docker-compose /usr/libexec/docker/cli-plugins/docker-compose

    # 리포지토리 clone
    git clone https://github.com/kyumin1227/gsc-slack-app.git /home/ec2-user/gsc-slack-app
    chown -R ec2-user:ec2-user /home/ec2-user/gsc-slack-app
  EOF

  tags = {
    Name = "${local.name_prefix}-monitoring"
  }

  lifecycle {
    prevent_destroy = true
  }
}
