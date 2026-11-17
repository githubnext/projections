Rails.application.routes.draw do
  get "up" => "rails/health#show", as: :rails_health_check

  root "pages#home"
  get "download", to: "downloads#latest"

  resources :releases, only: %i[index show], param: :version

  namespace :api do
    namespace :v1 do
      resources :licenses, only: :show, param: :key do
        resources :activations, only: %i[create destroy]
      end
      get "releases/latest", to: "releases#latest"
    end
  end

  namespace :admin do
    resources :licenses, except: :destroy
    resources :releases
  end
end
