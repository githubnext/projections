require_relative "boot"

require "rails"
require "active_record/railtie"
require "action_controller/railtie"

module Ledger
  class Application < Rails::Application
    config.load_defaults 7.1

    # Only loads a smaller set of middleware suitable for API only apps.
    config.api_only = true
  end
end
