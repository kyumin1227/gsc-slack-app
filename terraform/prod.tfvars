aws_region  = "ap-northeast-2"
app_name    = "bannote"
environment = "prod"

# ECS
container_image = "ghcr.io/kyumin1227/gsc-slack-app:latest"
container_port  = 3000
task_cpu        = 256
task_memory     = 512
desired_count   = 1

# RDS
db_instance_class = "db.t4g.micro"

# ElastiCache
cache_node_type = "cache.t4g.micro"

