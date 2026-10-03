use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidArgument,
    MissingArgument,
    UnknownCommand,
    UnknownOption,
    NotFound,
    Conflict,
    Validation,
    DataStore,
    DataCorrupt,
    VersionMismatch,
    Io,
    Sync,
    Internal,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn json(&self) -> Value {
        json!({
            "ok": false,
            "code": self.code,
            "error": self.message,
        })
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        classify(message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        classify(message.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(ErrorCode::Io, error.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

fn classify(message: String) -> AppError {
    let code = if message.contains("不存在") || message.contains("找不到") {
        ErrorCode::NotFound
    } else if message.contains("已存在") || message.contains("冲突") || message.contains("不能删除")
    {
        ErrorCode::Conflict
    } else if message.contains("未知命令") {
        ErrorCode::UnknownCommand
    } else if message.contains("未知选项") {
        ErrorCode::UnknownOption
    } else if message.contains("缺少参数") || message.contains("缺少值") {
        ErrorCode::MissingArgument
    } else if message.contains("参数") {
        ErrorCode::InvalidArgument
    } else if message.contains("不受当前版本") || message.contains("数据版本") {
        ErrorCode::VersionMismatch
    } else if message.contains("解析失败") {
        ErrorCode::DataCorrupt
    } else if message.contains("锁") || message.contains("数据文件") || message.contains("备份")
    {
        ErrorCode::DataStore
    } else if message.contains("无效") || message.contains("必须") || message.contains("不能为空")
    {
        ErrorCode::Validation
    } else {
        ErrorCode::Internal
    };
    AppError::new(code, message)
}

pub fn sync_error(message: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::Sync, message)
}
