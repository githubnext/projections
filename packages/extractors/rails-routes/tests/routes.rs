//! The static reader against Rails' own router.
//!
//! `tests/fixtures/expected` holds the route tables ActionPack 6.1.7.10's
//! `RouteSet` builds from each fixture (`tests/fixtures/oracle.rb` printed
//! them), so these tests check that the reader reproduces Rails' routing
//! semantics (names, paths, controllers, actions and their order), not merely
//! its own earlier output.

use projections_extractor_rails_routes::{Application, Route, api_only, evaluate};
use projections_extractor_ruby_support::{inflect::Inflections, parse};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn read(relative: &str) -> anyhow::Result<Option<String>> {
    let path = fixtures().join(relative);
    Ok(path.is_file().then(|| fs::read_to_string(path).unwrap()))
}

/// The routes and unresolved declarations of the application in `fixtures/<app>`.
fn evaluated(app: &str) -> (Vec<Route>, Vec<projections_extractor_rails_routes::Unresolved>) {
    let mut inflections = Inflections::default();
    let initializer = format!("{app}/config/initializers/inflections.rb");
    if let Some(source) = read(&initializer).unwrap() {
        inflections.read(&parse(&source, &initializer).unwrap());
    }
    let path = format!("{app}/config/routes.rb");
    let source = read(&path).unwrap().unwrap();
    let application = Application {
        root: "",
        path: &path,
        source: &source,
        api_only: read(&format!("{app}/config/application.rb")).unwrap().is_some_and(|s| api_only(&s)),
        inflections: &inflections,
        read: &read,
    };
    evaluate(&application).unwrap()
}

/// One route as both sides can state it: name, verbs, pattern, controller, action and endpoint.
type Row = (Option<String>, String, String, Option<String>, Option<String>, Option<String>);

fn rails(app: &str) -> Vec<Row> {
    let expected: Vec<Value> = serde_json::from_str(&read(&format!("expected/{app}.json")).unwrap().unwrap()).unwrap();
    expected
        .iter()
        .map(|route| {
            let text = |key: &str| route[key].as_str().map(str::to_owned);
            let verb = route["verb"].as_str().unwrap();
            let endpoint = if route["redirect"].is_string() {
                Some("redirect".to_owned())
            } else {
                text("endpoint")
            };
            (
                text("name"),
                if verb.is_empty() { "ANY".into() } else { verb.into() },
                text("path").unwrap(),
                text("controller"),
                text("action"),
                endpoint,
            )
        })
        .collect()
}

fn read_statically(routes: &[Route]) -> Vec<Row> {
    routes
        .iter()
        .map(|route| {
            let endpoint = route.endpoint.as_ref().map(|e| {
                if e.starts_with("redirect(") {
                    "redirect".to_owned()
                } else {
                    e.clone()
                }
            });
            (
                route.name.clone(),
                route.verbs.join("|"),
                route.pattern.clone(),
                route.controller.clone(),
                route.action.clone(),
                endpoint,
            )
        })
        .collect()
}

#[test]
fn reproduces_rails_route_tables() {
    for app in ["storefront", "api"] {
        let (routes, unresolved) = evaluated(app);
        assert!(unresolved.is_empty(), "{app}: {unresolved:#?}");
        let (actual, expected) = (read_statically(&routes), rails(app));
        for (index, (a, e)) in actual.iter().zip(&expected).enumerate() {
            assert_eq!(a, e, "{app}: route {index}");
        }
        assert_eq!(actual.len(), expected.len(), "{app}: route count");
    }
}

fn application<'a>(
    source: &'a str,
    inflections: &'a Inflections,
    read: &'a projections_extractor_rails_routes::Read<'a>,
) -> Application<'a> {
    Application {
        root: "web/",
        path: "web/config/routes.rb",
        source,
        api_only: false,
        inflections,
        read,
    }
}

const GEMS_AND_RUBY: &str = r#"require "sidekiq/web"

Rails.application.routes.draw do
  devise_for :users, controllers: { sessions: "users/sessions" }
  authenticate :user, ->(user) { user.admin? } do
    mount Sidekiq::Web => "/sidekiq"
  end
  %w[about terms].each do |page|
    get page, to: "pages##{page}"
  end
  get "status/#{ENV["REGION"]}", to: "status#show"
  if Rails.env.development?
    mount LetterOpenerWeb::Engine, at: "/letter_opener"
  end
  get "/up", to: "rails/health#show", as: :rails_health_check unless ENV["NO_HEALTH"]
  draw :missing
  resources :photos, only: :index, constraints: ->(request) { request.format == :json }
  get "about"
end
"#;

#[test]
fn lists_what_it_cannot_expand_and_keeps_conditions_as_written() {
    let inflections = Inflections::default();
    let none = |_: &str| Ok(None);
    let (routes, unresolved) = evaluate(&application(GEMS_AND_RUBY, &inflections, &none)).unwrap();
    let reasons: Vec<(usize, &str)> = unresolved.iter().map(|u| (u.line, u.reason.as_str())).collect();
    assert_eq!(reasons.len(), 6, "{reasons:#?}");
    assert!(reasons[0].1.contains("`devise_for` isn't part of Rails' routing DSL"));
    assert!(reasons[1].1.contains("`authenticate`"));
    assert_eq!(reasons[2], (8, "Ruby the routes reader doesn't evaluate"));
    assert!(reasons[3].1.contains("computed"));
    assert_eq!(reasons[4], (16, "config/routes/missing.rb doesn't exist"));
    assert!(reasons[5].1.contains("controller isn't given"));
    type Listed = (String, Option<String>, Vec<String>, Vec<String>);
    let rows: Vec<Listed> = routes
        .iter()
        .map(|r| {
            (
                format!("{} {}", r.verbs.join("|"), r.path),
                r.name.clone(),
                r.conditions.clone(),
                r.constraints.clone(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            (
                "ANY /letter_opener".into(),
                Some("letter_opener_web".into()),
                vec!["if Rails.env.development?".into()],
                vec![]
            ),
            (
                "GET /up".into(),
                Some("rails_health_check".into()),
                vec!["unless ENV[\"NO_HEALTH\"]".into()],
                vec![]
            ),
            (
                "GET /photos".into(),
                Some("photos".into()),
                vec![],
                vec!["->(request) { request.format == :json }".into()]
            ),
        ]
    );
}

#[test]
fn lists_routes_by_path_with_their_endpoints_as_signatures() {
    let inflections = Inflections::default();
    let none = |_: &str| Ok(None);
    let source = "Rails.application.routes.draw do\n  resources :photos, only: %i[index show]\n  get \"/old\", to: redirect(\"/photos\")\n  mount Blog::Engine => \"/blog\"\n  devise_for :users\nend\n";
    let (entities, unresolved) = projections_extractor_rails_routes::entities(&application(source, &inflections, &none)).unwrap();
    assert_eq!(unresolved, 1);
    let rows: Vec<(&str, &str, &str, &str)> = entities
        .iter()
        .map(|e| {
            (
                e["id"].as_str().unwrap(),
                e["kind"].as_str().unwrap(),
                e["label"].as_str().unwrap(),
                e["data"]["signature"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("route:web:/photos GET", "route", "GET /photos", "photos#index as photos"),
            ("route:web:/photos/:id GET", "route", "GET /photos/:id", "photos#show as photo"),
            ("route:web:/old GET", "route", "GET /old", "redirect(\"/photos\") as old"),
            ("mount:web:/blog", "mount", "/blog", "mount Blog::Engine as blog"),
            (
                "unresolved:web:web/config/routes.rb:devise_for :users",
                "unresolved",
                "devise_for :users",
                "`devise_for` isn't part of Rails' routing DSL (it may come from a gem), so its routes aren't expanded"
            ),
        ]
    );
    assert_eq!(entities[0]["evidence"][0]["location"]["line"], 2);
}

#[test]
fn draws_route_files_from_the_routes_folder() {
    let inflections = Inflections::default();
    let read = |path: &str| {
        Ok((path == "web/config/routes/admin.rb").then(|| "namespace :admin do\n  resources :users, only: :index\nend\n".to_owned()))
    };
    let source = "Rails.application.routes.draw do\n  draw :admin\nend\n";
    let (routes, unresolved) = evaluate(&application(source, &inflections, &read)).unwrap();
    assert!(unresolved.is_empty());
    assert_eq!(routes[0].path, "/admin/users");
    assert_eq!((routes[0].source.as_str(), routes[0].line), ("web/config/routes/admin.rb", 2));
}

#[test]
fn records_computed_requirements_endpoints_and_constraint_objects_as_written() {
    let inflections = Inflections::default();
    let none = |_: &str| Ok(None);
    let source = r#"Rails.application.routes.draw do
  root to: "home#index", protocol: (Rails.application.config.force_ssl ? "https://" : "http://"), as: "root"
  constraints DOMAINS do
    get "d", to: "d#show"
  end
  get "/old/*rest" => redirect { |params, _| "/new/#{params[:rest]}" }
  get "x", to: "x#show", as: SOME_NAME
end
"#;
    let (routes, unresolved) = evaluate(&application(source, &inflections, &none)).unwrap();
    assert_eq!(unresolved.len(), 1, "a computed name decides the route: {unresolved:#?}");
    assert_eq!(unresolved[0].line, 7);
    assert_eq!(
        routes[0].defaults,
        ["protocol: (Rails.application.config.force_ssl ? \"https://\" : \"http://\")"]
    );
    assert_eq!(
        (routes[1].path.as_str(), routes[1].constraints.as_slice()),
        ("/d", ["DOMAINS".to_owned()].as_slice())
    );
    assert!(routes[2].endpoint.as_deref().unwrap().starts_with("redirect { |params, _|"));
}
