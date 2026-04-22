resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name_prefix}-cluster"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = var.app_name
      image     = var.container_image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      secrets = [
        { name = "SLACK_BOT_TOKEN",                    valueFrom = "${var.secrets_arn}:SLACK_BOT_TOKEN::" },
        { name = "SLACK_APP_TOKEN",                    valueFrom = "${var.secrets_arn}:SLACK_APP_TOKEN::" },
        { name = "SLACK_SIGNING_SECRET",               valueFrom = "${var.secrets_arn}:SLACK_SIGNING_SECRET::" },
        { name = "GOOGLE_CLIENT_ID",                   valueFrom = "${var.secrets_arn}:GOOGLE_CLIENT_ID::" },
        { name = "GOOGLE_CLIENT_SECRET",               valueFrom = "${var.secrets_arn}:GOOGLE_CLIENT_SECRET::" },
        { name = "GOOGLE_SERVICE_ACCOUNT_EMAIL",       valueFrom = "${var.secrets_arn}:GOOGLE_SERVICE_ACCOUNT_EMAIL::" },
        { name = "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", valueFrom = "${var.secrets_arn}:GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY::" },
        { name = "DB_USERNAME",                        valueFrom = "${var.secrets_arn}:DB_USERNAME::" },
        { name = "DB_PASSWORD",                        valueFrom = "${var.secrets_arn}:DB_PASSWORD::" },
        { name = "DB_DATABASE",                        valueFrom = "${var.secrets_arn}:DB_DATABASE::" },
        { name = "ENCRYPTION_SECRET",                  valueFrom = "${var.secrets_arn}:ENCRYPTION_SECRET::" },
        { name = "REDIS_PASSWORD",                     valueFrom = "${var.secrets_arn}:REDIS_PASSWORD::" },
      ]

      environment = [
        { name = "DB_SYNCHRONIZE",  value = "false" },
        { name = "NODE_ENV",        value = "production" },
        { name = "SLACK_SOCKET_MODE", value = "false" },
        { name = "DB_HOST",        value = aws_db_instance.main.address },
        { name = "DB_PORT",        value = tostring(aws_db_instance.main.port) },
        { name = "REDIS_HOST",     value = aws_elasticache_cluster.main.cache_nodes[0].address },
        { name = "REDIS_PORT",     value = tostring(aws_elasticache_cluster.main.cache_nodes[0].port) },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = "/ecs/${local.name_prefix}"
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
          awslogs-create-group  = "true"
        }
      }
    }
  ])

  tags = {
    Name = "${local.name_prefix}-task"
  }
}

resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.app_name
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [task_definition]
  }

  tags = {
    Name = "${local.name_prefix}-service"
  }
}
