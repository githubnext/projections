variable "secret" {
  type      = string
  sensitive = true
  default   = "native-secret-never-persist"
}

module "net" {
  source = "./net"
  cidr   = "10.0.0.0/16"
}

resource "terraform_data" "db" {
  input            = { subnet = module.net.subnet, password = var.secret }
  triggers_replace = ["v2"]
}

resource "terraform_data" "app" {
  count = 2
  input = terraform_data.db.output
}

resource "terraform_data" "cache" {
  input      = terraform_data.db.output
  depends_on = [module.net]
}
