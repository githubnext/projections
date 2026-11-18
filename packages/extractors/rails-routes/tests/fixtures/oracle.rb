# Prints the route table ActionDispatch builds from a routes file, as JSON:
# the expected output the static reader is checked against.
#
#   ruby oracle.rb storefront/config/routes.rb > expected/storefront.json
#
# It needs only ActionPack and its dependencies (no application, Rails boot or
# database); the committed expected files were produced with ActionPack 6.1.7.10.
# The routes file may draw files from a routes/ folder beside it, and an
# application's config/application.rb and config/initializers/inflections.rb
# beside config/ are read as the static reader reads them.
require "json"
require "action_dispatch"
require "active_support/core_ext/object/with_options"

routes_file = File.expand_path(ARGV.fetch(0))
config = File.dirname(routes_file)

module Rails
  class Railtie; end
end

# Stand-ins for the Rack applications fixtures mount.
module Sidekiq
  class Web
    def self.call(env)
      [200, {}, []]
    end
  end
end
# A constraint object, as applications write them.
class ApiVersion
  def initialize(version)
    @version = version
  end

  def matches?(request)
    request.headers["Accept"].to_s.include?("version=#{@version}")
  end
end

class HealthCheck
  def self.call(env)
    [200, {}, ["ok"]]
  end
end

inflections = File.join(config, "initializers/inflections.rb")
load inflections if File.exist?(inflections)
application = File.join(config, "application.rb")
api_only = File.exist?(application) && File.read(application).match?(/^\s*config\.api_only\s*=\s*true/)

set = ActionDispatch::Routing::RouteSet.new(ActionDispatch::Routing::RouteSet::Config.new(nil, api_only))
set.draw_paths = [File.join(config, "routes")] if set.respond_to?(:draw_paths=)
Rails.define_singleton_method(:application) { Struct.new(:routes).new(set) }
load routes_file

routes = set.routes.map do |route|
  app = route.app
  app = app.app if app.respond_to?(:app) && !app.is_a?(ActionDispatch::Routing::RouteSet::Dispatcher) && !app.is_a?(ActionDispatch::Routing::Redirect)
  defaults = route.defaults.reject { |key, _| %i[controller action].include?(key) }
  {
    "name" => route.name,
    "verb" => route.verb,
    "path" => route.path.spec.to_s,
    "controller" => route.defaults[:controller],
    "action" => route.defaults[:action],
    "redirect" => app.is_a?(ActionDispatch::Routing::Redirect) ? app.inspect : nil,
    "endpoint" => app.is_a?(Class) ? app.name : nil,
    "requirements" => route.requirements.reject { |key, _| %i[controller action].include?(key) }.transform_values(&:inspect),
    "defaults" => defaults.transform_values(&:inspect),
  }
end
puts JSON.pretty_generate(routes)
