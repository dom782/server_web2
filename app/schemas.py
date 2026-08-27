from pydantic import BaseModel, EmailStr, Field
from typing import Literal

class AgentAuthIn(BaseModel):
    device_id: str
    device_secret: str

class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["OPERATOR", "OWNER"]

class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class ArticleSearchIn(BaseModel):
    cod_art: str = Field(min_length=1, max_length=100)

class OrderItemIn(BaseModel):
    cod_art: str
    description: str
    quantity: float = Field(gt=0)

class OrderCreateIn(BaseModel):
    recipient_id: str
    items: list[OrderItemIn] = Field(min_length=1, max_length=100)

class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: dict[str, str]
