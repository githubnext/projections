SECRET_KEY = "schema-fixture-not-a-production-secret"
INSTALLED_APPS = ["schemaapp"]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
