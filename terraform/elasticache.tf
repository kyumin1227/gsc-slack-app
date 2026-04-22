resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name_prefix}-cache-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = {
    Name = "${local.name_prefix}-cache-subnet-group"
  }
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "${local.name_prefix}-cache"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.cache_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.cache.id]

  tags = {
    Name = "${local.name_prefix}-cache"
  }
}
