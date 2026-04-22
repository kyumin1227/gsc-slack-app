terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    # bucket, key, region은 워크플로우에서 -backend-config로 주입
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_secretsmanager_secret_version" "app" {
  secret_id = var.secrets_arn
}

locals {
  secrets = jsondecode(data.aws_secretsmanager_secret_version.app.secret_string)
}
