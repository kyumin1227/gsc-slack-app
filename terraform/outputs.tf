output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.app.name
}

output "monitoring_instance_id" {
  description = "Monitoring EC2 instance ID (for MONITORING_INSTANCE_ID GitHub secret)"
  value       = aws_instance.monitoring.id
}

output "monitoring_public_ip" {
  description = "Monitoring EC2 public IP (for SSH)"
  value       = aws_instance.monitoring.public_ip
}

output "monitoring_private_ip" {
  description = "Monitoring EC2 private IP (used for LOKI_URL)"
  value       = aws_instance.monitoring.private_ip
}
