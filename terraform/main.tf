terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # bucket은 워크플로우에서 -backend-config로 주입
    key            = "gsc-slack-app/terraform.tfstate"
    region         = "ap-northeast-2"
    dynamodb_table = "terraform-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = var.app_name
      Environment = var.environment
    }
  }
}

data "aws_secretsmanager_secret_version" "app" {
  secret_id = var.secrets_arn
}

locals {
  secrets = jsondecode(data.aws_secretsmanager_secret_version.app.secret_string)
}
