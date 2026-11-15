from django.db import models
from django.db.models import Q
from .defaults import default_title


class Author(models.Model):
    email = models.CharField(max_length=160, unique=True, db_column="email_address")
    nickname = models.CharField(max_length=80, null=True, db_index=True)

    class Meta:
        db_table = "authors"
        indexes = [models.Index(fields=["-nickname", "email"], name="authors_search")]


class Tag(models.Model):
    label = models.CharField(max_length=64)

    class Meta:
        db_table = "tags"


class Post(models.Model):
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
    title = models.CharField(max_length=200, default=default_title)
    rating = models.IntegerField(default=0)
    tags = models.ManyToManyField(Tag)

    class Meta:
        db_table = "posts"
        constraints = [
            models.UniqueConstraint(fields=["author", "title"], name="posts_author_title"),
            models.CheckConstraint(check=Q(rating__gte=0), name="posts_positive_rating"),
        ]


class AuthorAlias(Author):
    class Meta:
        proxy = True


class ExternalRecord(models.Model):
    code = models.CharField(max_length=32, primary_key=True)

    class Meta:
        managed = False
        db_table = "external_records"
