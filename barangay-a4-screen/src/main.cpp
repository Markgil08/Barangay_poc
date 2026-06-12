#include <Arduino.h>
#include <SPI.h>
#include <TFT_eSPI.h>

TFT_eSPI tft = TFT_eSPI(); 

// Helper function to draw the base UI
void drawBaseUI() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE, TFT_BLACK);
  tft.setTextSize(3);
  tft.setCursor(20, 20);
  tft.println("A4 PRINTING STATION");
  tft.drawLine(0, 60, 480, 60, TFT_CYAN);
  tft.drawLine(0, 61, 480, 61, TFT_CYAN);
}

void setup() {
  // Sync baud rate with Node.js
  Serial.begin(115200);

  // CRITICAL: Turn on the screen backlight
  pinMode(27, OUTPUT);
  digitalWrite(27, HIGH);

  // Initialize Screen
  tft.init();
  tft.setRotation(1); // Landscape (480 wide x 320 tall)
  
  // Draw Initial State
  drawBaseUI();
  tft.setTextSize(4);
  tft.setTextColor(TFT_YELLOW, TFT_BLACK);
  tft.setCursor(20, 140);
  tft.println("Waiting for Scanner...");
}

void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim(); 

    drawBaseUI();

    if (command.startsWith("WAITING")) {
      tft.setTextSize(4);
      tft.setTextColor(TFT_YELLOW, TFT_BLACK);
      tft.setCursor(20, 140);
      tft.println("Waiting for Scanner...");
    } 
    else if (command.startsWith("ERROR:")) {
      tft.setTextSize(4);
      tft.setTextColor(TFT_RED, TFT_BLACK);
      tft.setCursor(20, 100);
      tft.println("ACCESS DENIED");
      
      tft.setTextSize(3);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      tft.setCursor(20, 160);
      String errorMsg = command.substring(6); 
      tft.println(errorMsg);
    } 
    else if (command.startsWith("READY:")) {
      tft.setTextSize(4);
      tft.setTextColor(TFT_GREEN, TFT_BLACK);
      tft.setCursor(20, 100);
      tft.println("READY TO PRINT");
      
      tft.setTextSize(3);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      tft.setCursor(20, 160);
      String docData = command.substring(6); 
      tft.println(docData);
    }
    else if (command.startsWith("DONE")) {
      tft.fillScreen(TFT_DARKGREEN);
      tft.setTextSize(4);
      tft.setTextColor(TFT_WHITE, TFT_DARKGREEN);
      tft.setCursor(50, 120);
      tft.println("PRINTING COMPLETE!");
      
      tft.setTextSize(3);
      tft.setCursor(50, 180);
      tft.println("Please collect your paper.");
    }
  }
}