variable "cidr" {
  type = string
}

resource "terraform_data" "vpc" {
  input = var.cidr
}

resource "terraform_data" "subnet" {
  input = terraform_data.vpc.output
}

output "subnet" {
  value = terraform_data.subnet.output
}
